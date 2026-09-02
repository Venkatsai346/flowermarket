/**
 * Runtime theming.
 *
 * A tenant's brand colour arrives in the bootstrap response and is written
 * straight onto `:root` as custom properties. One build, every store — and
 * because the storefront shell renders only after bootstrap resolves, the
 * customer never sees a flash of the wrong brand.
 */

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

/**
 * Relative luminance (WCAG). Used to pick readable text ON the brand colour —
 * a store that picks a pale yellow must not end up with white-on-yellow
 * buttons, so accessibility is computed rather than assumed.
 */
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

/** A very light tint of the brand, for soft buttons and highlights. */
export function softTint(hex, alpha = 0.08) {
  const rgb = parseHex(hex);
  if (!rgb) return '#fff1f2';
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function applyTheme(theme = {}) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const brand = parseHex(theme.primaryColor) ? theme.primaryColor : null;
  const accent = parseHex(theme.accentColor) ? theme.accentColor : null;

  if (brand) {
    const rgb = parseHex(brand);
    root.style.setProperty('--brand', brand);
    root.style.setProperty('--brand-ink', readableInk(brand));
    root.style.setProperty('--brand-soft', softTint(brand, 0.08));
    root.style.setProperty('--brand-ring', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', brand);
  }
  if (accent) root.style.setProperty('--accent', accent);
}

/** Title + description, so a shared link says the store's name, not ours. */
export function applyDocumentMeta({ name, tagline, description }) {
  if (typeof document === 'undefined') return;
  if (name) document.title = tagline ? `${name} · ${tagline}` : name;
  const desc = description || tagline;
  if (desc) {
    let tag = document.querySelector('meta[name="description"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'description');
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', desc);
  }
}

export default { applyTheme, applyDocumentMeta, readableInk, softTint };
