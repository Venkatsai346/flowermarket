/**
 * Database migration system — versioned, idempotent, forward-only.
 *
 * Each migration is a file in this directory named `YYYYMMDD_description.js`
 * and exports `{ up(db) }`. Migrations run in filename order; each successful
 * migration is recorded in a `migrations` collection so re-running is a no-op.
 *
 * Usage:
 *   node src/migrations/migrate.js           # run pending migrations
 *   node src/migrations/migrate.js --status  # show migration status
 *
 * CI/CD: add `node src/migrations/migrate.js` to the deploy pipeline BEFORE
 * the API starts. The API also runs pending migrations at boot (optional,
 * controlled by `MIGRATE_ON_BOOT=true`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connectDb, disconnectDb } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getMigrationFiles() {
  const files = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.js') && f !== 'migrate.js' && f !== '000_example.js')
    .sort();
  return files;
}

async function getCompletedMigrations(db) {
  const collection = db.collection('migrations');
  const docs = await collection.find({}).sort({ name: 1 }).toArray();
  return new Set(docs.map((d) => d.name));
}

async function recordMigration(db, name) {
  const collection = db.collection('migrations');
  await collection.insertOne({ name, appliedAt: new Date() });
}

async function runMigrations() {
  const { default: mongoose } = await import('mongoose');
  await connectDb();
  const db = mongoose.connection.db;

  const files = await getMigrationFiles();
  const completed = await getCompletedMigrations(db);
  const pending = files.filter((f) => !completed.has(f));

  if (process.argv.includes('--status')) {
    console.log(`\nMigration status:`);
    console.log(`  Total: ${files.length}`);
    console.log(`  Applied: ${completed.size}`);
    console.log(`  Pending: ${pending.length}`);
    if (pending.length) {
      console.log(`\nPending migrations:`);
      for (const f of pending) console.log(`  - ${f}`);
    }
    await disconnectDb();
    return;
  }

  if (pending.length === 0) {
    console.log('[migrate] All migrations applied — nothing to do.');
    await disconnectDb();
    return;
  }

  console.log(`[migrate] ${pending.length} pending migration(s):`);
  for (const file of pending) {
    const filePath = path.join(__dirname, file);
    const mod = await import(pathToFileURL(filePath).href);
    console.log(`[migrate] Running ${file}...`);
    try {
      await mod.up(db);
      await recordMigration(db, file);
      console.log(`[migrate] ✓ ${file} applied`);
    } catch (err) {
      console.error(`[migrate] ✗ ${file} FAILED:`, err.message);
      await disconnectDb();
      process.exit(1);
    }
  }

  console.log(`[migrate] ${pending.length} migration(s) applied successfully.`);
  await disconnectDb();
}

runMigrations().catch((err) => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
