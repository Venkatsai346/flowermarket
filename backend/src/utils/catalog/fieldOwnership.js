/**
 * FIELD OWNERSHIP — the core rule that makes shared-catalog multi-tenancy work.
 *
 * From the architecture doc: "if any tenant could edit title or images directly,
 * 50 dark stores could silently fork the same SKU into 50 different products."
 *
 * Every write path branches on this:
 *   - GLOBAL fields (on ProductMaster)   -> admin direct write OR tenant via
 *                                           ProductChangeRequest + review.
 *   - TENANT fields (on TenantProduct)   -> tenant direct write, optimistic-locked.
 */

// Fields on ProductMaster owned by CENTRAL ADMIN (globally shared identity).
export const MASTER_GLOBAL_FIELDS = Object.freeze(
  new Set([
    'title',
    'shortDescription',
    'description',
    'categoryId',
    'brandId',
    'barcode',
    'type',
    'tags',
    'isPerishable',
    'requiresColdChain',
    'defaultSellingUnit',
    'minOrderQty',
    'maxOrderQty',
    'complianceStatus',
  ])
);

// Fields on TenantProduct owned by THE TENANT (local overrides).
export const TENANT_LISTING_FIELDS = Object.freeze(
  new Set(['price', 'orderLimits'])
);

export const isGlobalMasterField = (key) => MASTER_GLOBAL_FIELDS.has(key);
export const isTenantListingField = (key) => TENANT_LISTING_FIELDS.has(key);

/** Split a master patch into global vs non-owned keys (for validation/error reporting). */
export function splitMasterPatch(patch = {}) {
  const global = {};
  const disallowed = {};
  for (const [k, v] of Object.entries(patch)) {
    if (isGlobalMasterField(k)) global[k] = v;
    else disallowed[k] = v;
  }
  return { global, disallowed };
}

export const GLOBAL_FIELD_LIST = Object.freeze([...MASTER_GLOBAL_FIELDS]);
export const TENANT_FIELD_LIST = Object.freeze([...TENANT_LISTING_FIELDS]);
