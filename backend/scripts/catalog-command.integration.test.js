import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';
import { runCatalogCommand, fingerprintCatalogRequest } from '../src/services/catalogCommand.service.js';
import { up as createCommandIndexes } from '../src/migrations/012_catalog_command_journal.js';

assert.equal(
  fingerprintCatalogRequest({ b: 2, nested: { z: 1, a: 2 }, a: 1 }),
  fingerprintCatalogRequest({ a: 1, nested: { a: 2, z: 1 }, b: 2 }),
  'fingerprints must be key-order independent',
);

let mongod = null;
let mongoUri = process.env.MONGODB_URI || null;
if (!mongoUri) {
  try {
    mongod = await createHermeticMongo();
    mongoUri = mongod.getUri();
  } catch (error) {
    if (error?.name === 'DownloadError' || error?.code === 'ECONNRESET' || /Could not start an in-memory mongod/.test(error?.message || '')) {
      console.log('catalog command integration: SKIP (local mongod unavailable; CI uses MongoDB service)');
      process.exit(0);
    }
    throw error;
  }
}

try {
  await mongoose.connect(mongoUri, { dbName: 'catalog-command-integration' });
  const db = mongoose.connection.db;
  await db.dropDatabase();
  await createCommandIndexes(db);
  const effects = db.collection('command_effects');
  let executions = 0;

  const invoke = () => runCatalogCommand({
    scopeId: 'tenant-a', idempotencyKey: 'create-rose-1', operation: 'test.create',
    request: { sku: 'ROSE', price: 100 },
    execute: async ({ registerCompensation }) => {
      executions += 1;
      const result = await effects.insertOne({ sku: 'ROSE' });
      registerCompensation(() => effects.deleteOne({ _id: result.insertedId }));
      return { id: String(result.insertedId), sku: 'ROSE' };
    },
  });

  const first = await invoke();
  const replay = await invoke();
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.value, first.value);
  assert.equal(executions, 1);
  assert.equal(await effects.countDocuments({}), 1);

  await assert.rejects(
    () => runCatalogCommand({
      scopeId: 'tenant-a', idempotencyKey: 'create-rose-1', operation: 'test.create',
      request: { sku: 'ROSE', price: 101 }, execute: async () => ({}),
    }),
    (error) => error.code === 'IDEMPOTENCY_KEY_REUSED',
  );

  let concurrentExecutions = 0;
  const concurrent = () => runCatalogCommand({
    scopeId: 'tenant-a', idempotencyKey: 'concurrent-1', operation: 'test.concurrent', request: { n: 1 },
    execute: async () => {
      concurrentExecutions += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { winner: true };
    },
  });
  const concurrentResults = await Promise.allSettled([concurrent(), concurrent()]);
  assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentResults.filter((result) => result.reason?.code === 'IDEMPOTENT_COMMAND_IN_PROGRESS').length, 1);
  assert.equal(concurrentExecutions, 1, 'only one concurrent claimant executes');

  await assert.rejects(
    () => runCatalogCommand({
      scopeId: 'tenant-a', idempotencyKey: 'fail-1', operation: 'test.fail', request: { n: 1 },
      execute: async ({ registerCompensation }) => {
        const result = await effects.insertOne({ transient: true });
        registerCompensation(() => effects.deleteOne({ _id: result.insertedId }));
        throw new Error('planned failure');
      },
    }),
    /planned failure/,
  );
  assert.equal(await effects.countDocuments({ transient: true }), 0, 'standalone fallback compensates writes');

  console.log('catalog command integration passed');
} finally {
  await mongoose.disconnect();
  await stopHermeticMongo(mongod);
}
