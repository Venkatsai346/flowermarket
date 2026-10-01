import crypto from 'node:crypto';
import mongoose from 'mongoose';
import CatalogCommand from '../models/catalogCommand.model.js';
import { conflict, internal } from '../utils/ApiError.js';
import { transactionsSupported } from '../utils/transactions.js';
import { catalogCommandRuns, catalogCommandDuration } from '../observability/registry.js';
import { localEmit, LOCAL_EVENTS } from '../utils/localEvents.js';

const LEASE_MS = 60_000;
const GLOBAL_SCOPE = 'global';

function canonicalize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function fingerprintCatalogRequest(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function keyConflict(message, code) {
  return conflict(message, code);
}

async function claim({ scopeId, idempotencyKey, operation, fingerprint }) {
  const ownerToken = crypto.randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  try {
    const [created] = await CatalogCommand.create([{
      scopeId, idempotencyKey, operation, requestFingerprint: fingerprint,
      ownerToken, leaseExpiresAt,
    }]);
    return { command: created, ownerToken, replay: false };
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const existing = await CatalogCommand.findOne({ scopeId, idempotencyKey });
  if (!existing) return claim({ scopeId, idempotencyKey, operation, fingerprint });
  if (existing.operation !== operation || existing.requestFingerprint !== fingerprint) {
    throw keyConflict('This idempotency key was already used for a different catalog request.', 'IDEMPOTENCY_KEY_REUSED');
  }
  if (existing.status === 'succeeded') return { command: existing, replay: true };
  if (existing.status === 'failed') {
    throw keyConflict('The previous request with this idempotency key failed and cannot be replayed.', 'IDEMPOTENT_COMMAND_FAILED');
  }

  const reclaimed = await CatalogCommand.findOneAndUpdate(
    { _id: existing.id, status: 'pending', leaseExpiresAt: { $lte: now } },
    { $set: { ownerToken, leaseExpiresAt }, $inc: { attempts: 1 } },
    { new: true },
  );
  if (reclaimed) return { command: reclaimed, ownerToken, replay: false };
  throw keyConflict('An identical catalog request is still being processed. Retry shortly.', 'IDEMPOTENT_COMMAND_IN_PROGRESS');
}

async function compensate(stack) {
  const errors = [];
  for (const undo of [...stack].reverse()) {
    // Compensation must run in strict reverse write order; parallel cleanup
    // could violate foreign-key-like ownership dependencies.
    // eslint-disable-next-line no-await-in-loop
    try { await undo(); } catch (error) { errors.push(error); }
  }
  return errors;
}

/**
 * Runs a catalog command atomically on replica sets/mongos. Standalone Mongo is
 * supported for local development through ordered writes and reverse-order
 * compensation supplied by the command callback.
 */
export async function runCatalogCommand({
  scopeId = GLOBAL_SCOPE, idempotencyKey = null, operation, request,
  execute, serialize = (value) => value,
}) {
  const started = process.hrtime.bigint();
  const key = idempotencyKey?.trim();
  if (key && key.length > 200) throw keyConflict('Idempotency key is too long.', 'INVALID_IDEMPOTENCY_KEY');
  const transactional = await transactionsSupported();
  if (!transactional && process.env.NODE_ENV === 'production') {
    throw internal(
      'Catalog writes require a transaction-capable MongoDB topology in production.',
      'CATALOG_TRANSACTIONS_REQUIRED',
    );
  }
  const fingerprint = fingerprintCatalogRequest(request);
  const claimed = key ? await claim({ scopeId: String(scopeId), idempotencyKey: key, operation, fingerprint }) : null;
  if (claimed?.replay) {
    catalogCommandRuns.inc({ operation, mode: 'journal', outcome: 'replayed' });
    catalogCommandDuration.observe({ operation, mode: 'journal' }, Number(process.hrtime.bigint() - started) / 1e9);
    return { value: claimed.command.response, replayed: true };
  }

  const session = await mongoose.startSession();
  const compensation = [];
  const registerCompensation = (undo) => { if (!transactional && typeof undo === 'function') compensation.push(undo); };
  let value;
  try {
    if (transactional) {
      await session.withTransaction(async () => {
        value = await execute({ session, registerCompensation });
        if (claimed) {
          const response = serialize(value);
          const updated = await CatalogCommand.updateOne(
            { _id: claimed.command.id, ownerToken: claimed.ownerToken, status: 'pending' },
            { $set: { status: 'succeeded', response, completedAt: new Date(), leaseExpiresAt: new Date() } },
            { session },
          );
          if (updated.matchedCount !== 1) throw keyConflict('Catalog command lease was lost.', 'COMMAND_LEASE_LOST');
        }
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } else {
      value = await execute({ session: null, registerCompensation });
      if (claimed) {
        const updated = await CatalogCommand.updateOne(
          { _id: claimed.command.id, ownerToken: claimed.ownerToken, status: 'pending' },
          { $set: { status: 'succeeded', response: serialize(value), completedAt: new Date(), leaseExpiresAt: new Date() } },
        );
        if (updated.matchedCount !== 1) throw keyConflict('Catalog command lease was lost.', 'COMMAND_LEASE_LOST');
      }
    }
    const mode = transactional ? 'transaction' : 'compensation';
    if (transactional) localEmit(LOCAL_EVENTS.CATALOG_WRITE, { operation });
    catalogCommandRuns.inc({ operation, mode, outcome: 'succeeded' });
    catalogCommandDuration.observe({ operation, mode }, Number(process.hrtime.bigint() - started) / 1e9);
    return { value, replayed: false };
  } catch (error) {
    const mode = transactional ? 'transaction' : 'compensation';
    catalogCommandRuns.inc({ operation, mode, outcome: 'failed' });
    catalogCommandDuration.observe({ operation, mode }, Number(process.hrtime.bigint() - started) / 1e9);
    if (!transactional) await compensate(compensation);
    if (claimed) await CatalogCommand.updateOne(
      { _id: claimed.command.id, ownerToken: claimed.ownerToken, status: 'pending' },
      { $set: { status: 'failed', completedAt: new Date(), leaseExpiresAt: new Date(), lastError: {
        code: error.code || 'CATALOG_COMMAND_FAILED', message: String(error.message || error).slice(0, 500), at: new Date(),
      } } },
    ).catch(() => {});
    throw error;
  } finally {
    await session.endSession();
  }
}

export function catalogIdempotencyKey(req) {
  const raw = req?.get?.('idempotency-key') || req?.headers?.['idempotency-key'];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export default { runCatalogCommand, fingerprintCatalogRequest, catalogIdempotencyKey };
