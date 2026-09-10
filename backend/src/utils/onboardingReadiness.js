/**
 * onboardingReadiness.js — can this store actually take an order?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `store.service.registerStore()` created a Tenant, an auth config, an owner
 * User and a trial subscription — and nothing else. But checkout requires a
 * Hub, a ServiceablePincode linked to it, an open DeliverySlot and a delivery
 * fee policy. So a self-registered storefront rendered, showed a catalogue, and
 * then refused every checkout with `PINCODE_UNSERVICEABLE` — correctly and
 * honestly, but with no path forward that the operator was ever told about.
 *
 * Worse, `store.isPublished` could be flipped to true throughout, putting a
 * store in front of customers that was structurally incapable of selling to
 * them.
 *
 * This module is the pure half of the fix: given a handful of COUNTS collected
 * from the database, it decides what is missing, which of those things block
 * publishing, and what to tell the merchant. Keeping it pure is deliberate —
 * the decision is the part worth testing exhaustively, and it can be tested
 * without a mongod, which the DB-backed suites cannot always guarantee.
 *
 * The service half (`store.service.collectOnboardingFacts`) only gathers facts.
 *
 * ── WHAT IS DELIBERATELY NOT SEEDED ─────────────────────────────────────────
 * A merchant's delivery area is a business fact nobody can guess. Seeding
 * pincodes at registration would make a store in Mumbai claim to serve
 * Kakinada, which is worse than serving nobody. So pincodes stay the first and
 * loudest blocking item here, and only the safely-defaultable skeleton (a hub
 * and an explicit, visible fee policy) is seeded at registration.
 */

/** Stable ids — the API contract, the admin UI and the tests all key off these. */
export const ONBOARDING_ITEM = Object.freeze({
  OWNER_EMAIL: 'ownerEmail',
  HUB: 'hub',
  PINCODES: 'pincodes',
  SLOTS: 'slots',
  FEE_POLICY: 'feePolicy',
  PRODUCTS: 'products',
  TAX_POLICIES: 'taxPolicies',
  PROFILE: 'profile',
  GSTIN: 'gstin',
});

export const ITEM_STATE = Object.freeze({
  DONE: 'done',
  TODO: 'todo',
  /** Not blocking, but a merchant who ignores it will have a bad day. */
  WARN: 'warn',
});

/**
 * @typedef {object} OnboardingFacts
 * @property {number}  activeHubs                  active Hub rows
 * @property {number}  serviceablePincodes         pincodes that are serviceable AND linked to a hub
 * @property {number}  pincodesWithoutHub          serviceable pincodes with no hubId (a silent dead end)
 * @property {number}  upcomingSlots               open slots from today forward
 * @property {boolean} hasActiveFeePolicy          an active DeliveryFeePolicy exists
 * @property {number}  activeProducts              sellable TenantProduct rows
 * @property {number}  categoriesInUse             distinct categories with an active listing
 * @property {number}  categoriesMissingTaxPolicy  of those, how many have no active TaxPolicy
 * @property {string|null} tagline
 * @property {string|null} gstin
 * @property {boolean} [ownerEmailVerified] absent in legacy fact pictures,
 *   which the evaluator treats as verified (old stores stay published)
 */

const asCount = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const asBool = (v) => v === true;
const asText = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Evaluate onboarding readiness.
 *
 * @param {Partial<OnboardingFacts>} [facts]
 * @param {object} [options]
 * @param {boolean} [options.requireReadyToPublish=true] refuse to publish while blocked
 * @param {number}  [options.slotDaysAhead=3]           how far ahead slots must exist
 * @returns {{
 *   items: Array<{id:string,label:string,hint:string,state:string,blocking:boolean,count:number|null}>,
 *   ready: boolean, canPublish: boolean, blocking: string[], warnings: string[],
 *   progress: {done:number,total:number,pct:number},
 *   reasons: string[]
 * }}
 */
export function evaluateOnboarding(facts = {}, options = {}) {
  // A default parameter covers `undefined` but NOT `null`, and a tenant row with
  // no store block, or a fact-gather that returned nothing, arrives as null.
  // Coerce explicitly: the whole point of this module is that it can be handed
  // an incomplete picture and still answer.
  const f = facts || {};
  const {
    requireReadyToPublish = true,
    slotDaysAhead = 3,
  } = options || {};

  const activeHubs = asCount(f.activeHubs);
  const serviceablePincodes = asCount(f.serviceablePincodes);
  const pincodesWithoutHub = asCount(f.pincodesWithoutHub);
  const upcomingSlots = asCount(f.upcomingSlots);
  const hasActiveFeePolicy = asBool(f.hasActiveFeePolicy);
  const activeProducts = asCount(f.activeProducts);
  const categoriesInUse = asCount(f.categoriesInUse);
  const categoriesMissingTaxPolicy = asCount(f.categoriesMissingTaxPolicy);
  const tagline = asText(f.tagline);
  const gstin = asText(f.gstin);

  const days = Number.isFinite(Number(slotDaysAhead)) && Number(slotDaysAhead) > 0
    ? Math.floor(Number(slotDaysAhead)) : 3;

  /**
   * Each item is a fact about the store plus what to do about it. `blocking`
   * means "a customer cannot complete a purchase until this exists" — the test
   * is whether checkout would fail, not whether the store looks finished.
   */
  const items = [
    {
      id: ONBOARDING_ITEM.OWNER_EMAIL,
      label: 'Verify your email address',
      hint: 'We send order alerts, invoices, and password resets to the owner '
        + 'email. Prove it is yours (a code by email) before the store goes live, '
        + 'so a typo cannot lock you out of your own shop.',
      done: ownerEmailVerified,
      blocking: true,
      count: null,
    },
    {
      id: ONBOARDING_ITEM.HUB,
      label: 'Add a delivery hub',
      hint: 'The location orders are packed and dispatched from. Every pincode you '
        + 'serve must point at one, and delivery slots belong to it.',
      done: activeHubs > 0,
      blocking: true,
      count: activeHubs,
    },
    {
      id: ONBOARDING_ITEM.PINCODES,
      label: 'Choose the pincodes you deliver to',
      hint: pincodesWithoutHub > 0
        ? `${pincodesWithoutHub} serviceable pincode(s) are not linked to a hub, so `
          + 'checkout still refuses them. Link them to a hub to activate them.'
        : 'Only you know your delivery area — nobody can guess it. Customers '
          + 'outside these pincodes are told honestly that you do not reach them.',
      // a pincode counts only when it is serviceable AND resolves to a hub,
      // which is exactly what resolveHub() demands at checkout
      done: serviceablePincodes > 0,
      blocking: true,
      count: serviceablePincodes,
    },
    {
      id: ONBOARDING_ITEM.SLOTS,
      label: `Open delivery slots for the next ${days} day${days === 1 ? '' : 's'}`,
      hint: 'Customers pick a window at checkout. With no open slot ahead of them '
        + 'there is nothing to choose, so the order cannot be placed.',
      done: upcomingSlots > 0,
      blocking: true,
      count: upcomingSlots,
    },
    {
      id: ONBOARDING_ITEM.FEE_POLICY,
      label: 'Set your delivery fee',
      hint: 'Without an active policy the platform falls back to a default number '
        + 'you did not choose. Set the fee, and a free-delivery threshold if you want one.',
      done: hasActiveFeePolicy,
      blocking: true,
      count: null,
    },
    {
      id: ONBOARDING_ITEM.PRODUCTS,
      label: 'List at least one product',
      hint: 'A published store with an empty catalogue sends customers away.',
      done: activeProducts > 0,
      blocking: true,
      count: activeProducts,
    },
    {
      id: ONBOARDING_ITEM.TAX_POLICIES,
      label: 'Add GST slab and HSN for your categories',
      hint: categoriesMissingTaxPolicy > 0
        ? `${categoriesMissingTaxPolicy} of ${categoriesInUse} categor(y/ies) you list in `
          + 'have no active tax policy and fall back to nil-rated (0%). That is a legal '
          + 'declaration, not a safe default — most flowers and gifts are taxable.'
        : 'Each category needs a GST slab and HSN code so invoices and GSTR-1 are correct.',
      // Blocking would be wrong: the nil-rated fallback is legal and the store
      // CAN trade. But it is the kind of thing that surfaces as a tax notice.
      done: categoriesInUse === 0 || categoriesMissingTaxPolicy === 0,
      blocking: false,
      count: categoriesMissingTaxPolicy,
    },
    {
      id: ONBOARDING_ITEM.PROFILE,
      label: 'Add a store tagline',
      hint: 'Shown under your store name on the storefront and in shared links.',
      done: Boolean(tagline),
      blocking: false,
      count: null,
    },
    {
      id: ONBOARDING_ITEM.GSTIN,
      label: 'Add your GSTIN',
      hint: 'Needed to issue a GST invoice. Without it, tax invoices go out without '
        + 'a supplier registration number.',
      done: Boolean(gstin),
      blocking: false,
      count: null,
    },
  ];

  const shaped = items.map((it) => ({
    id: it.id,
    label: it.label,
    hint: it.hint,
    state: it.done ? ITEM_STATE.DONE : (it.blocking ? ITEM_STATE.TODO : ITEM_STATE.WARN),
    blocking: it.blocking,
    count: it.count,
  }));

  const blocking = shaped.filter((i) => i.state === ITEM_STATE.TODO && i.blocking).map((i) => i.id);
  const warnings = shaped.filter((i) => i.state === ITEM_STATE.WARN).map((i) => i.id);
  const ready = blocking.length === 0;
  const done = shaped.filter((i) => i.state === ITEM_STATE.DONE).length;

  return {
    items: shaped,
    ready,
    // When the gate is disabled an operator can publish an unfinished store —
    // the escape hatch exists because being unable to publish during an
    // incident is worse than publishing early. `ready` still tells the truth.
    canPublish: requireReadyToPublish ? ready : true,
    blocking,
    warnings,
    progress: {
      done,
      total: shaped.length,
      pct: shaped.length ? Math.round((done / shaped.length) * 100) : 0,
    },
    // Human-readable, in the order a merchant should tackle them. This is what
    // the API error carries, so "you cannot publish" always says WHY.
    reasons: shaped
      .filter((i) => i.state === ITEM_STATE.TODO)
      .map((i) => i.label),
  };
}

export default { ONBOARDING_ITEM, ITEM_STATE, evaluateOnboarding };
