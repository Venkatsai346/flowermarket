/**
 * Merchant brand kits — three florist identities, not a raw hex picker.
 *
 * Colours live on `tenant.theme` so one storefront bundle can tint at
 * bootstrap. Hero photographs ship with the storefront (`/brand/hero-*.jpg`);
 * a merchant bannerUrl still wins when set.
 */
export const BRAND_KITS = Object.freeze({
  rose: Object.freeze({
    id: 'rose',
    name: 'Classic rose',
    primaryColor: '#9F1239',
    accentColor: '#C9A227',
    hero: '/brand/hero-rose.jpg',
  }),
  marigold: Object.freeze({
    id: 'marigold',
    name: 'Marigold temple',
    primaryColor: '#C2410C',
    accentColor: '#EAB308',
    hero: '/brand/hero-marigold.jpg',
  }),
  tropical: Object.freeze({
    id: 'tropical',
    name: 'Tropical green',
    primaryColor: '#0F766E',
    accentColor: '#65A30D',
    hero: '/brand/hero-tropical.jpg',
  }),
});

export const BRAND_KIT_IDS = Object.freeze(Object.keys(BRAND_KITS));

/** Fill kit + colours so a storefront never boots with a half-theme. */
export function resolveBrandTheme(theme = {}) {
  const kit = BRAND_KITS[theme.kit] || BRAND_KITS.rose;
  return {
    kit: kit.id,
    primaryColor: theme.primaryColor || kit.primaryColor,
    accentColor: theme.accentColor || kit.accentColor,
    heroUrl: kit.hero,
  };
}

export default BRAND_KITS;
