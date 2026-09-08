/**
 * Florist brand kits shared by the admin branding page and the storefront.
 *
 * ── MIRROR OF `backend/src/constants/brandKits.js` ──────────────────────────
 * The backend copy is the authority. This one exists because the branding
 * picker and the storefront shell need the catalogue at build time and cannot
 * import across the package boundary.
 *
 * It is not kept in sync by goodwill. `backend/scripts/invariants.test.js` §12
 * imports BOTH modules and asserts they agree on every kit id, every field of
 * every kit, and the resolved theme for a matrix of inputs — so a change on one
 * side fails the backend build. If you edit one, edit the other in the same
 * commit.
 *
 * This copy previously drifted: it grew `blurb`/`paper` that the backend lacked,
 * and its resolver honoured `theme.heroUrl` while the backend's discarded it.
 * Both resolvers now share one precedence rule.
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
 * Byte-for-byte the same precedence as the backend resolver, and a fixed point:
 * resolving an already-resolved theme returns it unchanged.
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
