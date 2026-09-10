/**
 * onboarding-readiness.test.js — F5: a self-registered store cannot sell anything.
 *
 *   node scripts/onboarding-readiness.test.js
 *
 * registerStore() created a Tenant, an auth config, an owner User and a trial
 * subscription. Checkout needs a hub, a serviceable pincode linked to it, an open
 * slot and a fee policy. So the storefront rendered, showed a catalogue, and
 * refused every checkout with PINCODE_UNSERVICEABLE — honestly, but with no path
 * forward the operator was ever told about, and `isPublished` could be flipped to
 * true the whole time.
 *
 * The DECISION is pure (utils/onboardingReadiness.js); only the fact-gathering
 * touches the database. That split is what makes this suite possible without a
 * mongod. Pure and exhaustive here, rather than one happy path in a DB suite.
 */

import assert from 'node:assert/strict';
import { evaluateOnboarding, ONBOARDING_ITEM, ITEM_STATE } from '../src/utils/onboardingReadiness.js';

let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };

const ids = (r) => r.items.map((i) => i.id);
const stateOf = (r, id) => r.items.find((i) => i.id === id)?.state;
const item = (r, id) => r.items.find((i) => i.id === id);

/** Everything a shop needs to trade — including a verified owner email. */
const READY = {
  activeHubs: 1,
  serviceablePincodes: 4,
  pincodesWithoutHub: 0,
  upcomingSlots: 15,
  hasActiveFeePolicy: true,
  activeProducts: 12,
  categoriesInUse: 3,
  categoriesMissingTaxPolicy: 0,
  tagline: 'Fresh cuts, same morning',
  gstin: '37ABCDE1234F1Z5',
  ownerEmailVerified: true,
};

/** Exactly what registerStore() leaves behind: nothing (email unverified). */
const EMPTY = {
  activeHubs: 0,
  serviceablePincodes: 0,
  pincodesWithoutHub: 0,
  upcomingSlots: 0,
  hasActiveFeePolicy: false,
  activeProducts: 0,
  categoriesInUse: 0,
  categoriesMissingTaxPolicy: 0,
  tagline: null,
  gstin: null,
  ownerEmailVerified: false,
};

console.log('\n── the reported bug, as a test ──────────────────────────');
{
  const r = evaluateOnboarding(EMPTY);
  assert.equal(r.ready, false);
  assert.equal(r.canPublish, false);
  assert.deepEqual(r.blocking, [
    ONBOARDING_ITEM.OWNER_EMAIL,
    ONBOARDING_ITEM.HUB,
    ONBOARDING_ITEM.PINCODES,
    ONBOARDING_ITEM.SLOTS,
    ONBOARDING_ITEM.FEE_POLICY,
    ONBOARDING_ITEM.PRODUCTS,
  ]);
  ok('a freshly registered store reports 6 blocking gaps and cannot publish');

  // The point of the finding: the operator is TOLD, in words, in order.
  assert.equal(r.reasons.length, 6);
  assert.match(r.reasons[0], /verify.*email|email.*verif/i);
  assert.match(r.reasons[1], /delivery hub/i);
  assert.match(r.reasons[2], /pincodes/i);
  assert.ok(r.reasons.every((s) => s.length > 10), 'every reason is a sentence, not a code');
  ok('reasons are human-readable and ordered the way a merchant should tackle them');
}

{
  const r = evaluateOnboarding(READY);
  assert.equal(r.ready, true);
  assert.equal(r.canPublish, true);
  assert.deepEqual(r.blocking, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.progress.done, r.progress.total);
  assert.equal(r.progress.pct, 100);
  ok('a complete store is ready, publishable, and 100% done');
}

console.log('\n── each blocking gap is detected on its own ─────────────');
{
  // Removing exactly one thing must name exactly that thing. A checklist that
  // only works when everything is missing is not a checklist.
  const gaps = [
    ['ownerEmailVerified', false, ONBOARDING_ITEM.OWNER_EMAIL],
    ['activeHubs', 0, ONBOARDING_ITEM.HUB],
    ['serviceablePincodes', 0, ONBOARDING_ITEM.PINCODES],
    ['upcomingSlots', 0, ONBOARDING_ITEM.SLOTS],
    ['hasActiveFeePolicy', false, ONBOARDING_ITEM.FEE_POLICY],
    ['activeProducts', 0, ONBOARDING_ITEM.PRODUCTS],
  ];
  for (const [field, emptyValue, expectedId] of gaps) {
    const r = evaluateOnboarding({ ...READY, [field]: emptyValue });
    assert.deepEqual(r.blocking, [expectedId],
      `removing ${field} should block on ${expectedId}, got ${r.blocking}`);
    assert.equal(r.ready, false);
    assert.equal(r.canPublish, false);
    assert.equal(stateOf(r, expectedId), ITEM_STATE.TODO);
  }
  ok('each of the 6 blocking gaps is isolated to its own item');
}

{
  // The silent dead end: a pincode marked serviceable but with no hubId. It looks
  // configured in the admin list, and resolveHub() still refuses it at checkout.
  const r = evaluateOnboarding({ ...READY, serviceablePincodes: 0, pincodesWithoutHub: 6 });
  assert.deepEqual(r.blocking, [ONBOARDING_ITEM.PINCODES]);
  assert.match(item(r, ONBOARDING_ITEM.PINCODES).hint, /6 serviceable pincode/);
  assert.match(item(r, ONBOARDING_ITEM.PINCODES).hint, /not linked to a hub/i);
  ok('pincodes with no hub are counted as a gap, and the hint says exactly why');
}

{
  // One of each is enough — the check is "can a customer check out", not
  // "is the store comprehensively configured".
  const r = evaluateOnboarding({
    ...READY, activeHubs: 1, serviceablePincodes: 1, upcomingSlots: 1, activeProducts: 1,
  });
  assert.equal(r.ready, true);
  ok('a single hub + pincode + slot + product is enough to trade');
}

console.log('\n── warnings inform but never block ──────────────────────');
{
  // No GSTIN, no tagline, and a tax gap — the store can still legally trade, so
  // publishing must not be refused. Blocking here would strand merchants.
  const r = evaluateOnboarding({ ...READY, tagline: null, gstin: null, categoriesMissingTaxPolicy: 2 });
  assert.equal(r.ready, true, 'warnings must not make the store unready');
  assert.equal(r.canPublish, true);
  assert.deepEqual(r.blocking, []);
  assert.deepEqual(r.warnings.sort(), [ONBOARDING_ITEM.GSTIN, ONBOARDING_ITEM.PROFILE, ONBOARDING_ITEM.TAX_POLICIES].sort());
  assert.equal(stateOf(r, ONBOARDING_ITEM.GSTIN), ITEM_STATE.WARN);
  assert.deepEqual(r.reasons, [], 'reasons carry blocking items only');
  ok('missing GSTIN / tagline / tax policy warn without blocking publish');
}

{
  // The nil-rated fallback is a legal declaration, not a safe default — the hint
  // has to say that plainly, because a merchant will otherwise read "done".
  const r = evaluateOnboarding({ ...READY, categoriesInUse: 5, categoriesMissingTaxPolicy: 5 });
  assert.equal(stateOf(r, ONBOARDING_ITEM.TAX_POLICIES), ITEM_STATE.WARN);
  assert.match(item(r, ONBOARDING_ITEM.TAX_POLICIES).hint, /nil-rated/);
  assert.match(item(r, ONBOARDING_ITEM.TAX_POLICIES).hint, /5 of 5/);
  ok('a category with no tax policy is told it will invoice at 0% GST');
}

{
  // No products yet means no categories, so there is nothing to declare. Flagging
  // tax coverage before a merchant has listed anything is noise.
  const r = evaluateOnboarding({ ...READY, activeProducts: 0, categoriesInUse: 0, categoriesMissingTaxPolicy: 0 });
  assert.deepEqual(r.blocking, [ONBOARDING_ITEM.PRODUCTS]);
  assert.equal(stateOf(r, ONBOARDING_ITEM.TAX_POLICIES), ITEM_STATE.DONE);
  ok('tax coverage is not demanded of a store with no listings yet');
}

console.log('\n── the escape hatch tells the truth ─────────────────────');
{
  // requireReadyToPublish=false exists for incidents, where being unable to
  // publish is worse than publishing early. It must relax canPublish WITHOUT
  // lying about ready/blocking — an operator still needs to see the gap.
  const r = evaluateOnboarding(EMPTY, { requireReadyToPublish: false });
  assert.equal(r.canPublish, true);
  assert.equal(r.ready, false, 'ready must keep reporting the truth');
  assert.equal(r.blocking.length, 6, 'the gaps must still be listed');
  // One item reads as done even for an empty store: tax coverage. With no
  // listings there are no categories, so there is nothing to declare — demanding
  // it before a merchant has listed anything would be noise.
  assert.equal(r.progress.done, 1, 'only the tax item is vacuously done');
  assert.equal(stateOf(r, ONBOARDING_ITEM.TAX_POLICIES), ITEM_STATE.DONE);
  ok('with the gate off, canPublish is true but ready/blocking still report the gaps');

  const strict = evaluateOnboarding(EMPTY, { requireReadyToPublish: true });
  assert.equal(strict.canPublish, false);
  ok('with the gate on (the default), publishing is refused');
}

{
  // The default must be the safe one.
  const r = evaluateOnboarding(EMPTY);
  assert.equal(r.canPublish, false);
  ok('the gate defaults to ON');
}

console.log('\n── garbage in, sane out ─────────────────────────────────');
{
  const r = evaluateOnboarding();
  assert.equal(r.ready, false);
  assert.equal(r.blocking.length, 6);
  ok('no facts at all behaves like a brand-new store');

  for (const junk of [null, undefined, 0]) {
    const j = evaluateOnboarding(junk === null ? null : {});
    assert.equal(j.items.length, 9);
  }
  ok('null / empty facts do not throw');

  // Negative and fractional counts must not invent progress.
  const r2 = evaluateOnboarding({
    activeHubs: -3, serviceablePincodes: -1, upcomingSlots: 0.5,
    activeProducts: NaN, categoriesInUse: -2, categoriesMissingTaxPolicy: -1,
    hasActiveFeePolicy: 'yes',
  });
  assert.equal(r2.blocking.length, 6);
  assert.equal(stateOf(r2, ONBOARDING_ITEM.HUB), ITEM_STATE.TODO);
  assert.equal(stateOf(r2, ONBOARDING_ITEM.FEE_POLICY), ITEM_STATE.TODO,
    'a truthy non-boolean is not "yes"');
  ok('negative, fractional, NaN and non-boolean facts count as nothing done');

  const r3 = evaluateOnboarding({ ...READY, activeHubs: 1e9, upcomingSlots: 2.9 });
  assert.equal(r3.ready, true);
  assert.equal(item(r3, ONBOARDING_ITEM.SLOTS).count, 2, 'counts are floored');
  ok('absurd counts are accepted and floored, not rejected');
}

{
  // Whitespace-only strings are not a tagline or a GSTIN.
  const r = evaluateOnboarding({ ...READY, tagline: '   ', gstin: '' });
  assert.equal(stateOf(r, ONBOARDING_ITEM.PROFILE), ITEM_STATE.WARN);
  assert.equal(stateOf(r, ONBOARDING_ITEM.GSTIN), ITEM_STATE.WARN);
  ok('a blank tagline or GSTIN is treated as missing');
}

console.log('\n── the contract the API and console depend on ───────────');
{
  const r = evaluateOnboarding(READY);
  assert.deepEqual(ids(r), [
    'ownerEmail', 'hub', 'pincodes', 'slots', 'feePolicy', 'products', 'taxPolicies', 'profile', 'gstin',
  ]);
  ok('item ids and their order are stable (the console renders this list)');

  for (const it of r.items) {
    assert.ok(it.id && it.label && it.hint, `${it.id} needs a label and a hint`);
    assert.ok(Object.values(ITEM_STATE).includes(it.state), `${it.id} has an unknown state`);
    assert.equal(typeof it.blocking, 'boolean');
    assert.ok(it.count === null || Number.isInteger(it.count), `${it.id} count must be an int or null`);
  }
  ok('every item carries id/label/hint/state/blocking/count');

  assert.equal(r.progress.total, 9);
  assert.equal(typeof r.progress.pct, 'number');
  ok('progress reports done/total/pct');

  // exactly one of the three states, and blocking items never "warn"
  for (const it of r.items) {
    if (it.blocking) assert.notEqual(it.state, ITEM_STATE.WARN,
      `${it.id} blocks, so it must be done or todo — never a soft warning`);
  }
  ok('a blocking item is never reported as a mere warning');
}

{
  // A partial store: progress must reflect reality, not round to 0 or 100.
  const r = evaluateOnboarding({ ...EMPTY, ownerEmailVerified: true, activeHubs: 1, hasActiveFeePolicy: true, activeProducts: 3 });
  assert.equal(r.progress.done, 5, 'email + hub + fee policy + products + tax(no categories) are done');
  assert.equal(r.progress.pct, 56);
  assert.deepEqual(r.blocking, [ONBOARDING_ITEM.PINCODES, ONBOARDING_ITEM.SLOTS]);
  ok('a half-configured store reports 56% and names the two things still missing');
}

console.log('\n── slotDaysAhead is reflected in the wording ────────────');
{
  const r3 = evaluateOnboarding(EMPTY, { slotDaysAhead: 3 });
  assert.match(item(r3, ONBOARDING_ITEM.SLOTS).label, /next 3 days/);
  const r1 = evaluateOnboarding(EMPTY, { slotDaysAhead: 1 });
  assert.match(item(r1, ONBOARDING_ITEM.SLOTS).label, /next 1 day\b/);
  assert.ok(!/1 days/.test(item(r1, ONBOARDING_ITEM.SLOTS).label), 'no "1 days"');
  ok('the slots label pluralises and tracks the configured horizon');

  const weird = evaluateOnboarding(EMPTY, { slotDaysAhead: NaN });
  assert.match(item(weird, ONBOARDING_ITEM.SLOTS).label, /next 3 days/, 'falls back to 3');
  ok('a nonsense horizon falls back to 3 days');
}

console.log('\n── owner email verification gates publishing ────────────');
{
  // Registration must never self-attest an address, so a fresh owner email is
  // unverified — and an unverified email alone blocks publishing, everything
  // else complete.
  const r = evaluateOnboarding({ ...READY, ownerEmailVerified: false });
  assert.deepEqual(r.blocking, [ONBOARDING_ITEM.OWNER_EMAIL]);
  assert.equal(r.ready, false);
  assert.equal(r.canPublish, false);
  assert.equal(stateOf(r, ONBOARDING_ITEM.OWNER_EMAIL), ITEM_STATE.TODO);
  assert.match(item(r, ONBOARDING_ITEM.OWNER_EMAIL).hint, /typo/i);
  ok('an unverified owner email blocks publishing on its own');
}

{
  // Unknown is unverified: an absent flag fails closed, exactly like every
  // other absent fact (an absent fee policy blocks too). Legacy tenants
  // without a recorded owner are grandfathered where the facts are GATHERED
  // (getOnboardingFacts, with DB context) — never here in the pure decision.
  const noFlag = { ...READY };
  delete noFlag.ownerEmailVerified;
  const r = evaluateOnboarding(noFlag);
  assert.deepEqual(r.blocking, [ONBOARDING_ITEM.OWNER_EMAIL]);
  ok('a missing flag counts as unverified (fail closed, like every absent fact)');
}

{
  const r = evaluateOnboarding({ ...READY, ownerEmailVerified: true });
  assert.equal(r.ready, true);
  assert.equal(stateOf(r, ONBOARDING_ITEM.OWNER_EMAIL), ITEM_STATE.DONE);
  ok('a verified owner email clears the gate');
}

console.log('\n── determinism ──────────────────────────────────────────');
{
  const a = evaluateOnboarding(READY);
  const b = evaluateOnboarding({ ...READY });
  assert.deepEqual(a, b);
  ok('identical facts produce identical output (safe to poll)');

  const r = evaluateOnboarding(EMPTY);
  assert.doesNotThrow(() => { r.items.push({ id: 'x' }); });
  // the caller mutating the result must not corrupt a later evaluation
  const again = evaluateOnboarding(EMPTY);
  assert.equal(again.items.length, 9);
  ok('a caller mutating the returned array cannot corrupt the next evaluation');
}

console.log(`\nONBOARDING READINESS: all ${pass} scenarios passed ✔\n`);
