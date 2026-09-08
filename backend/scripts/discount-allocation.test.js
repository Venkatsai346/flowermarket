/**
 * discount-allocation.test.js — F6: one allocation algorithm, not two.
 *
 *   node scripts/discount-allocation.test.js
 *
 * `utils/money.js` documents `allocatePaise` as the REPLACEMENT for "the last
 * line absorbs the rounding", which it calls "biased toward one line" and able
 * to "hand a negative share to a zero-priced item". Every paise split in the
 * codebase honoured that — the ledger, payouts, GST documents, refunds — except
 * `pricingPolicy.allocateDiscount()`, which still implemented the replaced
 * algorithm. It now routes through `allocatePaise` too.
 *
 * `allocateDiscount` is pure (it mutates the array it is given and touches no
 * collection), so the whole thing is testable without a database.
 */

import assert from 'node:assert/strict';
import pricing from '../src/services/pricingPolicy.service.js';
import { allocatePaise, toPaise, fromPaise, moneySum, roundMoney } from '../src/utils/money.js';

let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };

/** Build mutable line items the way computeOrderCharges does. */
const lines = (...totals) => totals.map((lineTotal) => ({ lineTotal, discountAllocated: 0 }));

/** The replaced algorithm, kept here only so the tests can prove it was worse. */
function oldAllocate(lineItems, discountTotal) {
  if (discountTotal <= 0) return;
  const subtotal = moneySum(...lineItems.map((l) => l.lineTotal));
  if (subtotal <= 0) return;
  let allocated = 0;
  lineItems.forEach((line, idx) => {
    line.discountAllocated = (idx === lineItems.length - 1)
      ? discountTotal - allocated
      : roundMoney(discountTotal * (line.lineTotal / subtotal));
    allocated += line.discountAllocated;
  });
}

const sum = (ls) => roundMoney(moneySum(...ls.map((l) => l.discountAllocated)));

console.log('\n── the exact regression F6 described ────────────────────');
{
  // Two ₹10 lines and a ₹0 freebie, discount ₹10.01. roundMoney(10.01 × ½)
  // rounds 5.005 UP twice, over-allocating by a paisa — and the old last-line
  // rule had no floor, so the freebie absorbed the −₹0.01.
  const oldLines = lines(10.00, 10.00, 0.00);
  oldAllocate(oldLines, 10.01);
  assert.equal(oldLines[0].discountAllocated, 5.01);
  assert.equal(oldLines[1].discountAllocated, 5.01);
  assert.ok(oldLines[2].discountAllocated < 0,
    `expected a negative share on the freebie, got ${oldLines[2].discountAllocated}`);
  ok('the OLD algorithm really did hand the ₹0 freebie a negative share');

  // WORSE THAN THE FINDING SAID. The last line's share was assigned raw, with no
  // roundMoney() — so what actually reached OrderItem was not −0.01 but a
  // sub-paisa float artifact. Mongoose would persist it, the invoice would print
  // it, and no reconciliation of "paise are integers" would ever match it.
  assert.equal(oldLines[2].discountAllocated, 10.01 - 10.02);
  assert.notEqual(oldLines[2].discountAllocated, -0.01);
  assert.ok(!Number.isInteger(oldLines[2].discountAllocated * 100),
    'the stored value is not a whole number of paise');
  ok('…and stored it as −0.009999999999999787 — not even a whole paisa');

  const newLines = lines(10.00, 10.00, 0.00);
  pricing.allocateDiscount(newLines, 10.01);
  assert.deepEqual(newLines.map((l) => l.discountAllocated), [5.01, 5.00, 0.00]);
  assert.equal(sum(newLines), 10.01);
  ok('the NEW split is [5.01, 5.00, 0.00] — same total, no negative line');
}

{
  // Every share the new algorithm writes is a whole number of paise, which is
  // what makes the persisted OrderItem values reconcilable against the ledger.
  const ls = lines(33.33, 33.33, 33.34, 0.00, 120.50);
  pricing.allocateDiscount(ls, 47.91);
  assert.ok(ls.every((l) => Number.isInteger(Math.round(l.discountAllocated * 100))
    && Math.abs(l.discountAllocated * 100 - Math.round(l.discountAllocated * 100)) < 1e-9),
    `a share is not a whole paisa: ${ls.map((l) => l.discountAllocated)}`);
  ok('every share is a whole number of paise (no float artifacts persisted)');
}

{
  // A negative discount on a line is not a curiosity: it inflates that line's
  // taxable base, because GST is computed on lineTotal − discountAllocated.
  const ls = lines(10.00, 10.00, 0.00);
  pricing.allocateDiscount(ls, 10.01);
  assert.ok(ls.every((l) => l.discountAllocated >= 0), 'no line goes negative');
  const taxable = ls.map((l) => roundMoney(l.lineTotal - l.discountAllocated));
  assert.deepEqual(taxable, [4.99, 5.00, 0.00]);
  ok('taxable bases stay ≤ lineTotal on every line (no inflated GST)');
}

console.log('\n── a zero-priced line never receives a share ────────────');
{
  const ls = lines(250.00, 0.00, 750.00);
  pricing.allocateDiscount(ls, 100.00);
  assert.equal(ls[1].discountAllocated, 0, 'the freebie takes nothing');
  assert.equal(sum(ls), 100.00);
  assert.deepEqual(ls.map((l) => l.discountAllocated), [25.00, 0.00, 75.00]);
  ok('a freebie in the MIDDLE gets 0 and the split is exactly proportional');
}

{
  // every line free → nothing to allocate against, and no crash
  const ls = lines(0.00, 0.00);
  pricing.allocateDiscount(ls, 50.00);
  assert.deepEqual(ls.map((l) => l.discountAllocated), [0, 0]);
  ok('an all-zero cart is left alone rather than dumping the discount on line 0');
}

console.log('\n── the sum is exact, for every shape ────────────────────');
{
  // The property that actually matters downstream: Σ discountAllocated must
  // equal discountTotal to the paisa, or the order's grandTotal and the sum of
  // its persisted OrderItem values disagree.
  const cases = [
    1, 0.01, 0.03, 999.99, 10.01, 1234.57, 0.07, 3.33,
  ];
  const shapes = [
    [10.00], [10.00, 10.00], [33.33, 33.33, 33.34], [0.01, 0.01, 0.01],
    [1000.00, 0.01], [7.77, 3.33, 91.02, 0.05], [1.11, 2.22, 3.33, 4.44, 5.55],
    [0.00, 500.00, 0.00, 500.00],
  ];

  let checked = 0;
  for (const shape of shapes) {
    for (const discount of cases) {
      const subtotal = moneySum(...shape);
      if (discount > subtotal) continue; // a coupon cannot exceed the cart
      const ls = lines(...shape);
      pricing.allocateDiscount(ls, discount);
      assert.equal(sum(ls), discount,
        `Σ shares ≠ discount for [${shape}] @ ${discount}: got ${sum(ls)}`);
      assert.ok(ls.every((l) => l.discountAllocated >= 0),
        `a negative share appeared for [${shape}] @ ${discount}`);
      checked += 1;
    }
  }
  assert.ok(checked > 40, `expected a broad matrix, ran ${checked}`);
  ok(`${checked} shape × discount combinations all sum exactly, none negative`);
}

{
  // A pseudo-random sweep, because hand-picked cases flatter an algorithm.
  let seed = 20260908;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 3000; i += 1) {
    const n = 1 + Math.floor(rnd() * 7);
    const shape = Array.from({ length: n }, () => roundMoney(rnd() * (rnd() < 0.15 ? 0 : 500)));
    const subtotal = moneySum(...shape);
    if (subtotal <= 0) continue;
    const discount = roundMoney(rnd() * subtotal);
    const ls = lines(...shape);
    pricing.allocateDiscount(ls, discount);
    assert.equal(sum(ls), discount, `Σ mismatch for [${shape}] @ ${discount} → ${sum(ls)}`);
    assert.ok(ls.every((l) => l.discountAllocated >= 0), `negative for [${shape}] @ ${discount}`);
    // no line may be discounted by more than it costs
    ls.forEach((l, k) => assert.ok(l.discountAllocated <= l.lineTotal + 0.0001,
      `line ${k} discounted above its own total in [${shape}] @ ${discount}`));
  }
  ok('3000 pseudo-random carts: exact sum, non-negative, never over-discounted');
}

console.log('\n── it IS allocatePaise, not a lookalike ─────────────────');
{
  const shape = [33.33, 33.33, 33.34, 0.00, 120.50];
  const discount = 47.91;
  const ls = lines(...shape);
  pricing.allocateDiscount(ls, discount);

  const expected = allocatePaise(toPaise(discount), shape.map(toPaise)).map(fromPaise);
  assert.deepEqual(ls.map((l) => l.discountAllocated), expected);
  ok('line-for-line identical to allocatePaise on the same weights');
}

console.log('\n── the bias is gone ─────────────────────────────────────');
{
  // Largest-remainder has a hard guarantee the old rule did not: every part is
  // within ONE PAISA of its exact proportional share, because each part is
  // either floor(exact) or floor(exact)+1. "Last line absorbs the residue" has
  // no such bound — it absorbs whatever the other N−1 roundings left behind, so
  // its error grows with the number of lines.
  const shape = [10.00, 10.00, 10.00, 10.00];
  const subtotal = moneySum(...shape);
  const exactShare = (discount) => (discount * 10.00) / subtotal;

  let worstOldLastPaisa = 0;
  let worstOldOtherPaisa = 0;
  let worstNewPaisa = 0;

  for (let paisa = 1; paisa <= 4000; paisa += 1) {
    const discount = fromPaise(paisa);
    if (discount > subtotal) break;
    const exact = exactShare(discount);

    const o = lines(...shape); oldAllocate(o, discount);
    o.forEach((l, i) => {
      const err = Math.abs(l.discountAllocated - exact) * 100;
      if (i === o.length - 1) worstOldLastPaisa = Math.max(worstOldLastPaisa, err);
      else worstOldOtherPaisa = Math.max(worstOldOtherPaisa, err);
    });

    const n = lines(...shape); pricing.allocateDiscount(n, discount);
    n.forEach((l) => {
      worstNewPaisa = Math.max(worstNewPaisa, Math.abs(l.discountAllocated - exact) * 100);
    });
  }

  assert.ok(worstOldLastPaisa > 1,
    `expected the old last line to exceed a paisa of error, got ${worstOldLastPaisa}`);
  ok(`OLD let the last line drift ${worstOldLastPaisa.toFixed(2)} paisa from its exact share`);

  assert.ok(worstOldLastPaisa > worstOldOtherPaisa * 2,
    `the bias should be concentrated on one line: ${worstOldLastPaisa} vs ${worstOldOtherPaisa}`);
  ok(`…vs ${worstOldOtherPaisa.toFixed(2)} paisa on the others — the bias is concentrated, not spread`);

  assert.ok(worstNewPaisa < 1 + 1e-9,
    `largest-remainder must stay under one paisa, got ${worstNewPaisa}`);
  ok(`NEW never exceeds ${worstNewPaisa.toFixed(2)} paisa on ANY line (the <1 paisa guarantee)`);
}

{
  // The error is not merely uneven, it is UNBOUNDED in the line count: with N
  // identical lines that all round up, the last line absorbs −(N−1)/2 paisa.
  const worst = (n) => {
    const shape = Array.from({ length: n }, () => 10.00);
    const subtotal = moneySum(...shape);
    let max = 0;
    for (let paisa = 1; paisa <= 2000; paisa += 1) {
      const discount = fromPaise(paisa);
      if (discount > subtotal) break;
      const exact = (discount * 10.00) / subtotal;
      const o = lines(...shape); oldAllocate(o, discount);
      max = Math.max(max, Math.abs(o[o.length - 1].discountAllocated - exact) * 100);
    }
    return max;
  };

  const w4 = worst(4);
  const w20 = worst(20);
  assert.ok(w20 > w4, `error should grow with line count: 4 lines=${w4}, 20 lines=${w20}`);
  ok(`OLD last-line error grows with cart size: ${w4.toFixed(2)} paisa @4 lines → ${w20.toFixed(2)} @20`);

  // …while the new split stays bounded no matter how many lines the cart has.
  const shape = Array.from({ length: 20 }, () => 10.00);
  const subtotal = moneySum(...shape);
  let maxNew = 0;
  for (let paisa = 1; paisa <= 2000; paisa += 1) {
    const discount = fromPaise(paisa);
    if (discount > subtotal) break;
    const exact = (discount * 10.00) / subtotal;
    const n = lines(...shape); pricing.allocateDiscount(n, discount);
    n.forEach((l) => { maxNew = Math.max(maxNew, Math.abs(l.discountAllocated - exact) * 100); });
  }
  assert.ok(maxNew < 1 + 1e-9, `NEW must stay under a paisa even at 20 lines, got ${maxNew}`);
  ok(`NEW stays under one paisa at 20 lines (${maxNew.toFixed(2)}) — bounded regardless of cart size`);
}

{
  // Identical lines must be treated identically. The old rule made the last
  // line structurally different from the other three IN THE SAME CART — measure
  // that as the spread (max − min) across four equal ₹10 lines.
  const shape = [10.00, 10.00, 10.00, 10.00];
  const spreadOf = (ls) => {
    const v = ls.map((l) => Math.round(l.discountAllocated * 100));
    return Math.max(...v) - Math.min(...v);
  };

  let worstOldSpread = 0;
  let worstNewSpread = 0;
  let trials = 0;
  for (let paisa = 1; paisa <= 400; paisa += 1) {
    const discount = fromPaise(paisa);
    const o = lines(...shape); oldAllocate(o, discount);
    const n = lines(...shape); pricing.allocateDiscount(n, discount);
    worstOldSpread = Math.max(worstOldSpread, spreadOf(o));
    worstNewSpread = Math.max(worstNewSpread, spreadOf(n));
    trials += 1;
  }

  assert.equal(worstNewSpread, 1,
    `four identical lines must differ by at most one paisa, got ${worstNewSpread}`);
  ok(`NEW: four identical lines never differ by more than 1 paisa (over ${trials} discounts)`);

  assert.ok(worstOldSpread > worstNewSpread,
    `old spread ${worstOldSpread} should exceed new ${worstNewSpread}`);
  ok(`OLD: the same four identical lines differed by up to ${worstOldSpread} paisa`);
}

console.log('\n── degenerate inputs are no-ops, not crashes ────────────');
{
  const ls = lines(100.00, 200.00);
  pricing.allocateDiscount(ls, 0);
  assert.deepEqual(ls.map((l) => l.discountAllocated), [0, 0]);
  ok('a ₹0 discount changes nothing');

  pricing.allocateDiscount(ls, -50);
  assert.deepEqual(ls.map((l) => l.discountAllocated), [0, 0]);
  ok('a negative discount is refused rather than allocating a credit');

  const empty = [];
  assert.doesNotThrow(() => pricing.allocateDiscount(empty, 50));
  ok('an empty cart does not throw');

  const untouched = lines(100.00);
  pricing.allocateDiscount(untouched, undefined);
  assert.deepEqual(untouched.map((l) => l.discountAllocated), [0]);
  pricing.allocateDiscount(untouched, null);
  assert.deepEqual(untouched.map((l) => l.discountAllocated), [0]);
  pricing.allocateDiscount(untouched, NaN);
  assert.deepEqual(untouched.map((l) => l.discountAllocated), [0]);
  pricing.allocateDiscount(untouched, 'abc');
  assert.deepEqual(untouched.map((l) => l.discountAllocated), [0]);
  ok('undefined / null / NaN / non-numeric discounts are all no-ops');

  // A NUMERIC string is different: coupons and form payloads can arrive as
  // strings, and both the old and new code accept them. Coercion is intended,
  // so assert it rather than accidentally "fixing" it later.
  const coerced = lines(100.00);
  pricing.allocateDiscount(coerced, '10');
  assert.deepEqual(coerced.map((l) => l.discountAllocated), [10]);
  ok('a numeric string discount is still honoured (coercion is intended)');

  const single = lines(350.75);
  pricing.allocateDiscount(single, 350.75);
  assert.deepEqual(single.map((l) => l.discountAllocated), [350.75]);
  ok('a single line takes the whole discount exactly');
}

console.log('\n── determinism (idempotent re-pricing depends on it) ────');
{
  const shape = [7.77, 3.33, 91.02, 0.05, 18.18];
  const first = lines(...shape); pricing.allocateDiscount(first, 23.47);
  for (let i = 0; i < 50; i += 1) {
    const again = lines(...shape); pricing.allocateDiscount(again, 23.47);
    assert.deepEqual(again.map((l) => l.discountAllocated), first.map((l) => l.discountAllocated));
  }
  ok('50 repeated runs produce the identical split');

  // re-running over already-allocated lines must not compound
  const twice = lines(...shape);
  pricing.allocateDiscount(twice, 23.47);
  const snapshot = twice.map((l) => l.discountAllocated);
  pricing.allocateDiscount(twice, 23.47);
  assert.deepEqual(twice.map((l) => l.discountAllocated), snapshot);
  ok('a second pass overwrites rather than accumulating (no compounded discount)');
}

console.log(`\nDISCOUNT ALLOCATION: all ${pass} scenarios passed ✔\n`);
