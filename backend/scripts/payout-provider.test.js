/**
 * payout-provider.test.js — PURE disbursement-layer tests (Phase 6.3 / M5).
 *
 *   node scripts/payout-provider.test.js
 *
 * No database, no network. These assert the behaviours that prevent the one
 * unrecoverable failure in the whole platform: paying a vendor twice.
 */

import crypto from 'node:crypto';
import payoutProvider, { selectTransferMode, mockOutcomeFor } from '../src/services/payoutProvider.service.js';
import config from '../src/config/index.js';
import { toPaise } from '../src/utils/money.js';
import { PAYOUT_STATE } from '../src/constants/enums.js';
import { canTransition } from '../src/utils/payoutStateMachine.js';

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${expected}, got ${actual}`);
const section = (t) => console.log(`\n${t}`);

const ACCOUNT = { method: 'bank', holderName: 'Rose Farms LLP', ifsc: 'HDFC0001234', accountNumber: '12345678901', maskedAccount: '****8901' };

// ---------------------------------------------------------------------------
section('1. transfer-rail selection');
// ---------------------------------------------------------------------------
eq('UPI destination → UPI', selectTransferMode({ method: 'upi', amountPaise: toPaise(1000) }), 'UPI');
eq('₹50,000 bank transfer → IMPS (instant)', selectTransferMode({ method: 'bank', amountPaise: toPaise(50000) }), 'IMPS');
eq('₹2,00,000 → RTGS (high value)', selectTransferMode({ method: 'bank', amountPaise: toPaise(200000) }), 'RTGS');
eq('₹1,99,999 stays on IMPS', selectTransferMode({ method: 'bank', amountPaise: toPaise(199999) }), 'IMPS');

// ---------------------------------------------------------------------------
section('2. the mock provider makes every unhappy path testable');
// ---------------------------------------------------------------------------
eq('…13 paise → provider rejection', mockOutcomeFor(toPaise(100.13)), 'failed');
eq('…17 paise → paid then bank-reversed', mockOutcomeFor(toPaise(100.17)), 'reversed');
eq('…99 paise → ambiguous timeout', mockOutcomeFor(toPaise(100.99)), 'ambiguous');
eq('anything else → clean payment', mockOutcomeFor(toPaise(5279.10)), 'paid');

// ---------------------------------------------------------------------------
section('3. console provider — the happy path');
// ---------------------------------------------------------------------------
{
  const r = await payoutProvider.payout({
    idempotencyKey: 'payout:v1:2026-09-01:2026-09-08',
    amountPaise: toPaise(5279.10),
    account: ACCOUNT,
    batchNumber: 'PO-2609-000001',
  });
  check('accepted', r.ok === true, JSON.stringify(r));
  check('not ambiguous', r.ambiguous === false);
  check('a provider reference came back', Boolean(r.providerRef));
  check('a UTR came back', Boolean(r.utr));
  eq('mode chosen for the amount', r.mode, 'IMPS');
}

// ---------------------------------------------------------------------------
section('4. ★ the ambiguous branch — where double payments are born');
// ---------------------------------------------------------------------------
{
  const original = config.payouts.provider;
  config.payouts.provider = 'mock';

  const key = 'payout:v2:2026-09-01:2026-09-08';
  const amount = toPaise(1234.99); // …99 → the gateway "times out"

  const r = await payoutProvider.payout({ idempotencyKey: key, amountPaise: amount, account: ACCOUNT });
  check('a timeout does NOT throw (throwing invites a naive retry)', r !== undefined);
  eq('it is not reported as success', r.ok, false);
  eq('★ it is flagged AMBIGUOUS, not failed', r.ambiguous, true);
  check('no provider reference to act on', !r.providerRef);
  check('the error says the outcome is unknown', /unknown/i.test(r.error || ''), r.error);

  // the only legitimate way forward: ask the provider what happened
  const found = await payoutProvider.fetchByIdempotencyKey({ idempotencyKey: key, amountPaise: amount });
  check('reconciliation finds the instruction', found.found === true);
  eq('★ the money HAD in fact moved — a retry would have paid twice', found.status, 'processed');
  check('reconciliation returns the UTR', Boolean(found.utr));

  // and the state machine physically forbids the retry
  check('★ PROCESSING → QUEUED is not a legal transition',
    !canTransition(PAYOUT_STATE.PROCESSING, PAYOUT_STATE.QUEUED));

  config.payouts.provider = original;
}

// ---------------------------------------------------------------------------
section('5. clean rejection IS retryable');
// ---------------------------------------------------------------------------
{
  const original = config.payouts.provider;
  config.payouts.provider = 'mock';

  const r = await payoutProvider.payout({
    idempotencyKey: 'payout:v3:x', amountPaise: toPaise(500.13), account: ACCOUNT,
  });
  eq('rejected', r.ok, false);
  eq('explicitly NOT ambiguous — no money moved', r.ambiguous, false);
  check('a reason is given', Boolean(r.error));
  check('FAILED → QUEUED is legal (safe to retry)', canTransition(PAYOUT_STATE.FAILED, PAYOUT_STATE.QUEUED));

  config.payouts.provider = original;
}

// ---------------------------------------------------------------------------
section('6. idempotency — the same key always yields the same reference');
// ---------------------------------------------------------------------------
{
  const key = 'payout:v4:2026-09-01:2026-09-08';
  const a = await payoutProvider.payout({ idempotencyKey: key, amountPaise: toPaise(1000), account: ACCOUNT });
  const b = await payoutProvider.payout({ idempotencyKey: key, amountPaise: toPaise(1000), account: ACCOUNT });
  eq('provider reference is deterministic from the key', a.providerRef, b.providerRef);
  eq('UTR is deterministic too', a.utr, b.utr);

  const other = await payoutProvider.payout({ idempotencyKey: 'payout:v5:different', amountPaise: toPaise(1000), account: ACCOUNT });
  check('a different key yields a different reference', other.providerRef !== a.providerRef);
}

// ---------------------------------------------------------------------------
section('7. guards');
// ---------------------------------------------------------------------------
{
  const zero = await payoutProvider.payout({ idempotencyKey: 'k', amountPaise: 0, account: ACCOUNT });
  eq('a zero payout is refused', zero.ok, false);
  const neg = await payoutProvider.payout({ idempotencyKey: 'k', amountPaise: -100, account: ACCOUNT });
  eq('a negative payout is refused', neg.ok, false);
}

// ---------------------------------------------------------------------------
section('8. webhook signature verification');
// ---------------------------------------------------------------------------
{
  const secret = 'whsec_test_payouts';
  const body = JSON.stringify({ event: 'payout.processed', payload: { payout: { entity: { id: 'pout_x', reference_id: 'payout:v1:a:b', utr: 'UTR123' } } } });
  const raw = Buffer.from(body, 'utf8');
  const good = crypto.createHmac('sha256', secret).update(raw).digest('hex');

  eq('a valid signature verifies',
    payoutProvider.verifyWebhook({ provider: 'razorpayx', rawBody: raw, signature: good, secret }).ok, true);
  eq('a tampered body fails',
    payoutProvider.verifyWebhook({ provider: 'razorpayx', rawBody: Buffer.from(`${body} `), signature: good, secret }).ok, false);
  eq('a wrong signature fails',
    payoutProvider.verifyWebhook({ provider: 'razorpayx', rawBody: raw, signature: 'deadbeef', secret }).ok, false);
  eq('a missing signature fails',
    payoutProvider.verifyWebhook({ provider: 'razorpayx', rawBody: raw, signature: null, secret }).ok, false);
  eq('a missing secret fails closed',
    payoutProvider.verifyWebhook({ provider: 'razorpayx', rawBody: raw, signature: good, secret: null }).ok, false);

  // a signature of the right length but wrong value must still fail — this is
  // what timingSafeEqual is for, and it throws if lengths differ
  const wrongSameLength = good.replace(/.$/, good.endsWith('a') ? 'b' : 'a');
  eq('a same-length wrong signature fails without throwing',
    payoutProvider.verifyWebhook({ provider: 'razorpayx', rawBody: raw, signature: wrongSameLength, secret }).ok, false);
}

// ---------------------------------------------------------------------------
section('9. webhook parsing into our vocabulary');
// ---------------------------------------------------------------------------
{
  const rzp = payoutProvider.parseWebhook({
    event: 'payout.processed',
    payload: { payout: { entity: { id: 'pout_abc', reference_id: 'payout:v1:a:b', utr: 'UTR999' } } },
  });
  eq('razorpayx processed → paid', rzp.outcome, 'paid');
  eq('provider reference extracted', rzp.providerRef, 'pout_abc');
  eq('our idempotency key round-trips', rzp.idempotencyKey, 'payout:v1:a:b');
  eq('UTR extracted', rzp.utr, 'UTR999');

  eq('razorpayx failed → failed',
    payoutProvider.parseWebhook({ event: 'payout.failed', payload: { payout: { entity: {} } } }).outcome, 'failed');
  eq('razorpayx reversed → reversed',
    payoutProvider.parseWebhook({ event: 'payout.reversed', payload: { payout: { entity: {} } } }).outcome, 'reversed');
  eq('cashfree TRANSFER_SUCCESS → paid',
    payoutProvider.parseWebhook({ event: 'TRANSFER_SUCCESS', data: { transferId: 'tid', utr: 'U1' } }).outcome, 'paid');
  eq('cashfree TRANSFER_REVERSED → reversed',
    payoutProvider.parseWebhook({ event: 'TRANSFER_REVERSED', data: {} }).outcome, 'reversed');

  const unknown = payoutProvider.parseWebhook({ event: 'payout.pending', payload: { payout: { entity: {} } } });
  eq('an unmapped event maps to null rather than being guessed', unknown.outcome, null);
  eq('the raw event is still reported', unknown.event, 'payout.pending');
}

// ---------------------------------------------------------------------------
section('10. unconfigured real providers fail loudly, never silently succeed');
// ---------------------------------------------------------------------------
{
  const original = config.payouts.provider;

  config.payouts.provider = 'razorpayx';
  const rx = await payoutProvider.payout({ idempotencyKey: 'k', amountPaise: toPaise(100), account: ACCOUNT });
  eq('razorpayx without credentials → not ok', rx.ok, false);
  check('and says why', /not configured/i.test(rx.error || ''), rx.error);
  check('and is NOT ambiguous (nothing was ever sent)', !rx.ambiguous);

  config.payouts.provider = 'cashfree';
  const cf = await payoutProvider.payout({ idempotencyKey: 'k', amountPaise: toPaise(100), account: ACCOUNT });
  eq('cashfree without credentials → not ok', cf.ok, false);
  check('and is NOT ambiguous', !cf.ambiguous);

  config.payouts.provider = original;
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
console.log(`payout provider: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log('✅ disbursement safety properties hold\n');
