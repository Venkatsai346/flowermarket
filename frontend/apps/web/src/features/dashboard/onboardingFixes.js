/**
 * Where each onboarding gap gets fixed. Ids are the API contract from
 * ONBOARDING_ITEM (backend utils/onboardingReadiness.js).
 *
 * `ownerEmail` has no route — it is verified inline (code by email) because
 * leaving the page to prove an address would be absurd. Shared by the
 * dashboard checklist and by every other page that can hit STORE_NOT_READY
 * (e.g. Storefront branding), so a blocked publish always names a way forward.
 */
export const FIX_ROUTE = {
  hub: { to: '/hubs', label: 'Add a hub' },
  pincodes: { to: '/hubs', label: 'Manage pincodes' },
  slots: { to: '/hubs', label: 'Open slots' },
  feePolicy: { to: '/policies', label: 'Set the fee' },
  products: { to: '/catalog', label: 'List products' },
  taxPolicies: { to: '/tax', label: 'Add tax policies' },
  profile: { to: '/storefront', label: 'Edit branding' },
  gstin: { to: '/tax', label: 'Add GSTIN' },
};
