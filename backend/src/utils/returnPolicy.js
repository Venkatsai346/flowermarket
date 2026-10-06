export const PRODUCT_RETURN_MODE = Object.freeze({
  RETURNABLE: 'returnable',
  QUALITY_CLAIM_ONLY: 'quality_claim_only',
  FINAL_SALE: 'final_sale',
});

export const DEFAULT_RETURN_WINDOW_DAYS = 7;
export const DEFAULT_INSTANT_CLAIM_HOURS = 24;

/**
 * Resolve one immutable, customer-facing policy from catalog data.
 * Explicit ProductMaster policy always wins. The fallback preserves historical
 * behavior for masters created before return governance existed.
 */
export function resolveReturnPolicy(master = {}) {
  const configured = master.returnPolicy || {};
  let mode = configured.mode;
  if (!Object.values(PRODUCT_RETURN_MODE).includes(mode)) {
    const pickupFriendlyPerishable = ['flower_bouquet', 'plant'].includes(master.type);
    mode = master.isPerishable && !pickupFriendlyPerishable
      ? PRODUCT_RETURN_MODE.QUALITY_CLAIM_ONLY
      : PRODUCT_RETURN_MODE.RETURNABLE;
  }
  return {
    mode,
    returnWindowDays: mode === PRODUCT_RETURN_MODE.RETURNABLE
      ? Math.max(0, Number(configured.returnWindowDays ?? DEFAULT_RETURN_WINDOW_DAYS))
      : 0,
    instantClaimHours: mode === PRODUCT_RETURN_MODE.FINAL_SALE
      ? 0
      : Math.max(0, Number(configured.instantClaimHours ?? DEFAULT_INSTANT_CLAIM_HOURS)),
    requiresQc: mode === PRODUCT_RETURN_MODE.RETURNABLE && configured.requiresQc !== false,
    customerNote: String(configured.customerNote || '').trim() || null,
  };
}

export function permitsClaim(policy, claimType) {
  const resolved = resolveReturnPolicy({ returnPolicy: policy });
  if (resolved.mode === PRODUCT_RETURN_MODE.FINAL_SALE) return false;
  if (claimType === 'pickup_qc') return resolved.mode === PRODUCT_RETURN_MODE.RETURNABLE && resolved.returnWindowDays > 0;
  if (claimType === 'instant_claim') return resolved.instantClaimHours > 0;
  return false;
}
