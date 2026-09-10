/**
 * One-way data migration: tenant plan-billing rows out of `subscriptions`.
 *
 * History: Phase-5 billing squatted on the `subscriptions` collection for
 * STORE plan subscriptions. The vocabulary split moves those rows to
 * `tenant_subscriptions`, leaving `subscriptions` to the CUSTOMER
 * recurring-order schema (Phase 7.8.1) it always belonged to.
 *
 *   Dry run (default, writes nothing):  node scripts/migrate-tenant-subscriptions.js
 *   Apply:                              node scripts/migrate-tenant-subscriptions.js --apply
 *
 * Safety contract:
 *  - Only documents WITH a `planCode` field move (the billing discriminator).
 *    Customer rows (userId/frequency/nextDeliveryAt) are never touched.
 *  - Idempotent: re-runs skip `_id`s already present in the target.
 *  - Verified: a source row is deleted ONLY after its target copy reads back
 *    identical (`_id` + `planCode` + `tenantId` + `status`).
 *  - Any unverified move aborts with a non-zero exit; nothing is retried blind.
 *
 * Run BEFORE deploying the split code (old code reads `subscriptions`, new
 * code reads `tenant_subscriptions` — migrate in the deploy window).
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';

const APPLY = process.argv.includes('--apply');

/** Move one billing row; returns 'moved' | 'skipped' | 'verify-failed'. */
async function moveRow(source, target, row) {
  const already = await target.findOne({ _id: row._id }, { projection: { _id: 1 } });
  if (already) return 'skipped';
  await target.insertOne({ ...row });
  const back = await target.findOne({ _id: row._id });
  const identical = back
    && String(back.tenantId) === String(row.tenantId)
    && back.planCode === row.planCode
    && back.status === row.status;
  if (!identical) return 'verify-failed';
  await source.deleteOne({ _id: row._id });
  return 'moved';
}

async function main() {
  await connectDb();
  const db = mongoose.connection.db;
  const source = db.collection('subscriptions');
  const target = db.collection('tenant_subscriptions');

  const billingRows = await source.find({ planCode: { $exists: true } }).toArray();
  const customerRows = await source.countDocuments({ planCode: { $exists: false } });
  console.log(`[migrate] ${billingRows.length} tenant-billing row(s) in \`subscriptions\`, ${customerRows} customer row(s) (untouched).`);

  if (!APPLY) {
    for (const row of billingRows) {
      console.log(`[migrate] DRY-RUN would move _id=${row._id} tenant=${row.tenantId} plan=${row.planCode} status=${row.status}`);
    }
    console.log('[migrate] dry run complete — re-run with --apply to write.');
    await disconnectDb();
    return;
  }

  let moved = 0;
  let skipped = 0;
  // Sequential on purpose: each row is verified in the target before its own
  // source row is deleted — a migration must never parallelise deletes past
  // another row's verification.
  for (const row of billingRows) {
    // eslint-disable-next-line no-await-in-loop
    const outcome = await moveRow(source, target, row);
    if (outcome === 'verify-failed') {
      console.error(`[migrate] VERIFY FAILED for _id=${row._id} — aborting, source row kept.`);
      await disconnectDb();
      process.exit(1);
    }
    if (outcome === 'moved') moved += 1;
    else skipped += 1;
  }

  console.log(`[migrate] done: moved=${moved} already-migrated-skipped=${skipped} customer-rows-untouched=${customerRows}`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[migrate] fatal:', err);
  try { await disconnectDb(); } catch { /* already down */ }
  process.exit(1);
});
