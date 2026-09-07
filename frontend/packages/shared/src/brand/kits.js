/**
 * Florist brand kits shared by the admin branding page and the storefront.
 * Keep in lockstep with `backend/src/constants/brandKits.js`.
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

export function resolveBrandTheme(theme = {}) {
  const kit = BRAND_KITS[theme.kit] || BRAND_KITS.rose;
  return {
    kit: kit.id,
    primaryColor: theme.primaryColor || kit.primaryColor,
    accentColor: theme.accentColor || kit.accentColor,
    heroUrl: theme.heroUrl || kit.hero,
    paperUrl: kit.paper,
  };
}

export default BRAND_KITS;
