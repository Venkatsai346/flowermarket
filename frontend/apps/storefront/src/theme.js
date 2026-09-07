/**
 * Runtime theming + document meta (OG / canonical).
 *
 * A tenant's brand kit arrives in the bootstrap response and is written
 * straight onto `:root`. One build, every store — and because the storefront
 * shell renders only after bootstrap resolves, the customer never sees a
 * flash of the wrong brand.
 */
import { BRAND_KITS, resolveBrandTheme } from '@flower-market/shared';

/** #rrggbb → {r,g,b}; tolerant of #rgb and missing '#'. */
function parseHex(hex) {
  if (!hex) return null;
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function luminance({ r, g, b }) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function readableInk(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return '#ffffff';
  return luminance(rgb) > 0.55 ? '#111827' : '#ffffff';
}

export function softTint(hex, alpha = 0.08) {
  const rgb = parseHex(hex);
  if (!rgb) return '#fff1f2';
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function applyTheme(theme = {}) {
  if (typeof document === 'undefined') return;
  const resolved = resolveBrandTheme(theme);
  const root = document.documentElement;
  const brand = parseHex(resolved.primaryColor) ? resolved.primaryColor : BRAND_KITS.rose.primaryColor;
  const accent = parseHex(resolved.accentColor) ? resolved.accentColor : BRAND_KITS.rose.accentColor;
  const rgb = parseHex(brand);

  root.dataset.kit = resolved.kit;
  root.style.setProperty('--brand', brand);
  root.style.setProperty('--brand-ink', readableInk(brand));
  root.style.setProperty('--brand-soft', softTint(brand, 0.08));
  root.style.setProperty('--brand-ring', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--paper', `url(${BRAND_KITS[resolved.kit]?.paper || '/brand/empty-petals.jpg'})`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', brand);
}

function upsertMeta(attr, key, value) {
  if (typeof document === 'undefined' || !value) return;
  let tag = document.querySelector(`meta[${attr}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', value);
}

function upsertLink(rel, href) {
  if (typeof document === 'undefined' || !href) return;
  let tag = document.querySelector(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', href);
}

function absoluteUrl(url, origin) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!base) return url;
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

/** Title + description + OG + canonical, so a shared link says the store's name. */
export function applyDocumentMeta({
  name,
  tagline,
  description,
  image,
  canonicalUrl,
  path,
} = {}) {
  if (typeof document === 'undefined') return;
  const title = name ? (tagline ? `${name} · ${tagline}` : name) : document.title;
  if (name) document.title = title;
  const desc = description || tagline || '';
  if (desc) upsertMeta('name', 'description', desc);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = canonicalUrl
    ? `${canonicalUrl.replace(/\/$/, '')}${path || (typeof window !== 'undefined' ? window.location.pathname : '/')}`
    : (typeof window !== 'undefined' ? window.location.href : '');
  const ogImage = absoluteUrl(image, origin);

  upsertMeta('property', 'og:title', title);
  if (desc) upsertMeta('property', 'og:description', desc);
  upsertMeta('property', 'og:type', 'website');
  if (url) upsertMeta('property', 'og:url', url);
  if (ogImage) upsertMeta('property', 'og:image', ogImage);
  upsertMeta('name', 'twitter:card', 'summary_large_image');
  if (url) upsertLink('canonical', url);
}

export { BRAND_KITS, resolveBrandTheme };
export default { applyTheme, applyDocumentMeta, readableInk, softTint };
