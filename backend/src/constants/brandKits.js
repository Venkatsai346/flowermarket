/**
 * Merchant brand kits — three florist identities, not a raw hex picker.
 *
 * Colours live on `tenant.theme` so one storefront bundle can tint at
 * bootstrap. Hero photographs ship with the storefront (`/brand/hero-*.jpg`);
 * a merchant bannerUrl still wins when set.
 *
 * ── THIS FILE IS THE AUTHORITY ──────────────────────────────────────────────
 * `frontend/packages/shared/src/brand/kits.js` holds a copy, because the admin
 * branding picker and the storefront shell need the catalogue at build time and
 * cannot import across the package boundary. Copies drift, and this pair did:
 * the frontend grew `blurb` and `paper`, and — more seriously — the two
 * resolvers encoded DIFFERENT precedence for `heroUrl` (`theme.heroUrl ||
 * kit.hero` versus `kit.hero`), so the moment a tenant stored a `heroUrl` the
 * backend would have silently discarded a field the client was already sending.
 *
 * Both copies are therefore kept field-for-field identical, backend first, and
 * `scripts/invariants.test.js` §12 imports BOTH modules and asserts they agree
 * structurally and behaviourally. Do not add a field here without adding it
 * there; the invariant will fail the build until you do.
 *
 * `blurb` and `paper` are presentation metadata the backend does not itself
 * render. They live here anyway so that bootstrap can serve the complete kit and
 * so that "identical" is a meaningful invariant rather than a partial one.
 */
export const BRAND_KITS = Object.freeze({
  rose: Object.freeze({
    id: 'rose',
    name: 'Classic rose',
    blurb: 'Velvet reds, kraft paper, wedding studio light.',
    primaryColor: '#9F1239',
    accentColor: '#C9A227',
    hero: '/brand/hero-rose.jpg',
    paper: '/brand/empty-petals.jpg',
  }),
  marigold: Object.freeze({
    id: 'marigold',
    name: 'Marigold temple',
    blurb: 'Saffron garlands, brass, South-Indian courtyard gold.',
    primaryColor: '#C2410C',
    accentColor: '#EAB308',
    hero: '/brand/hero-marigold.jpg',
    paper: '/brand/empty-petals.jpg',
  }),
  tropical: Object.freeze({
    id: 'tropical',
    name: 'Tropical green',
    blurb: 'Monstera, orchids, a humid studio against moss plaster.',
    primaryColor: '#0F766E',
    accentColor: '#65A30D',
    hero: '/brand/hero-tropical.jpg',
    paper: '/brand/empty-petals.jpg',
  }),
});

export const BRAND_KIT_IDS = Object.freeze(Object.keys(BRAND_KITS));

/**
 * Fill kit + colours so a storefront never boots with a half-theme.
 *
 * Precedence, in full and identical to the shared copy:
 *   kit          — the requested kit, or `rose` when unknown/absent
 *   primaryColor — the tenant's override, else the kit's
 *   accentColor  — the tenant's override, else the kit's
 *   heroUrl      — the tenant's override, else the kit's hero
 *   paperUrl     — always the kit's (no tenant override exists for it)
 *
 * Because every output field is also an accepted input field with the same
 * precedence, resolving an already-resolved theme is a FIXED POINT — which is
 * what makes it safe that the storefront calls this again on the theme
 * bootstrap already resolved. §12 asserts that property rather than assuming it.
 */
export function resolveBrandTheme(theme = {}) {
  const kit = BRAND_KITS[theme?.kit] || BRAND_KITS.rose;
  return {
    kit: kit.id,
    primaryColor: theme?.primaryColor || kit.primaryColor,
    accentColor: theme?.accentColor || kit.accentColor,
    heroUrl: theme?.heroUrl || kit.hero,
    paperUrl: kit.paper,
  };
}

export default BRAND_KITS;
