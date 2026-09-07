/**
 * seed-vendor-carry-views.mjs — Phase 17 one-off migration.
 *
 * Pre-Phase-17 carry-forward batches recorded `carryForwardPaise` (cash
 * units) but had no `carryLedgerViewPaise` (the vendor_payable face). Their
 * debt now reconciles as 0 — the books still owe the drained share, so the
 * vendor would show drift forever.
 *
 * Recovery is exact: a carry batch's book face is the sum of its pinned
 * (consumed) lines' book views + the opening's book face + the adjustments
 * it pinned. Re-running is a no-op (only zero-face carries are touched, and
 * the value is recomputed, not incremented).
 *
 *   node scripts/seed-vendor-carry-views.mjs            (live DB from .env)
 *   DRY_RUN=true node scripts/seed-vendor-carry-views.mjs
 */
import mongoose from 'mongoose';
import config from '../src/config/index.js';
import PayoutBatch from '../src/models/payoutBatch.model.js';
import PayoutLineItem from '../src/models/payoutLineItem.model.js';
import PayoutAdjustment from '../src/models/payoutAdjustment.model.js';
import payoutService from '../src/services/payout.service.js';
import { sumPaise, fromPaise } from '../src/utils/money.js';

const DRY = process.env.DRY_RUN === 'true';

const view = (l) => payoutService.lineLedgerViewPaise(l);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  const carries = await PayoutBatch.find({ carryForwardPaise: { $ne: 0 }, carryLedgerViewPaise: 0 })
    .select('_id batchNumber carryForwardPaise openingLedgerViewPaise state').lean();
  console.log(`🩹 seed-vendor-carry-views — ${carries.length} zero-face carry batch(es) found${DRY ? ' (DRY RUN)' : ''}`);
  for (const b of carries) {
    const lines = await PayoutLineItem.find({ payoutBatchId: b._id }).lean();
    const adj = await PayoutAdjustment.find({ appliedInBatchId: b._id }).lean();
    const face = sumPaise(...lines.map(view), b.openingLedgerViewPaise || 0, ...adj.map((a) => a.amountPaise));
    console.log(`   ${b.batchNumber} [${b.state}]: cash ${fromPaise(b.carryForwardPaise)} → book face ${fromPaise(face)} (${lines.length} line(s), ${adj.length} adjustment(s))`);
    if (!DRY) await PayoutBatch.updateOne({ _id: b._id }, { $set: { carryLedgerViewPaise: face } });
  }
  console.log(DRY ? 'DRY RUN — nothing written' : 'done');
  await mongoose.disconnect();
}

main().catch((e) => { console.error('💥', e.message); process.exit(1); });
