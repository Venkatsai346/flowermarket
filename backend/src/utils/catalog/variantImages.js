/**
 * variantImages.js — PURE variant-image resolution (no DB, no config, no I/O).
 *
 * THE RULE (the answer to "what photo does the red polo show?"):
 *   1. Active images scoped to the variant (variantId match) win when ANY exist.
 *   2. Otherwise the master gallery (variantId == null) is the fallback.
 *
 * Why fallback instead of "every variant must upload photos": a master with 40
 * variants and one shared photoshoot is the common case, and forcing 40
 * duplicate uploads would fork storage and guarantee stale copies. Fallback
 * keeps one canonical gallery and lets variants override only when they have
 * genuinely different photos (different colors almost always do).
 *
 * `imageSource` ('variant' | 'master') travels with every resolution so UIs can
 * badge it ("using product photos") and ops can see which variants still need
 * a shoot. Same pure discipline as money.js / gst.js / ranking.js — proven by
 * `scripts/variant-images.test.js` without any infrastructure.
 */

/** Normalize an id-ish to string for comparison (ObjectId, string, null). */
export function idKey(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && typeof v.toString === 'function') return v.toString();
  return String(v);
}

/** Is this image row active? (soft-deleted rows are filtered by the plugin in
 *  live queries, but lean/aggregate callers pass raw rows — check both.) */
export function isUsableImage(img) {
  if (!img || !img.url) return false;
  if (img.isDeleted === true) return false;
  if (img.status && img.status !== 'active') return false;
  return true;
}

/** Primary-first, then sortOrder — the gallery order everywhere. */
export function sortGallery(images) {
  return [...(images || [])].sort((a, b) => {
    const pa = a?.isPrimary ? 0 : 1;
    const pb = b?.isPrimary ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0);
  });
}

/**
 * Split a master's flat image rows into the master gallery + per-variant map.
 * @param {Array} images flat ProductImage rows (lean ok)
 * @returns {{ master: Array, byVariant: Map<string, Array> }}
 */
export function groupImagesByVariant(images) {
  const master = [];
  const byVariant = new Map();
  for (const img of images || []) {
    if (!isUsableImage(img)) continue;
    const vk = idKey(img.variantId ?? img.variant_id ?? null);
    if (!vk) {
      master.push(img);
    } else {
      if (!byVariant.has(vk)) byVariant.set(vk, []);
      byVariant.get(vk).push(img);
    }
  }
  return { master: sortGallery(master), byVariant };
}

/**
 * Resolve the gallery for ONE variant: its own images, else the master fallback.
 * @param {Array} images flat image rows for the master
 * @param {string|ObjectId|null} variantId
 * @returns {{ images: Array, source: 'variant'|'master' }}
 */
export function resolveImagesForVariant(images, variantId) {
  const { master, byVariant } = groupImagesByVariant(images);
  const vk = idKey(variantId);
  if (vk && byVariant.has(vk)) {
    return { images: sortGallery(byVariant.get(vk)), source: 'variant' };
  }
  return { images: master, source: 'master' };
}

/**
 * The single display URL for a variant (card thumbnails, cart snapshots,
 * search index). Null when neither the variant nor the master has photos.
 */
export function primaryImageUrlFor(images, variantId) {
  const { images: gallery } = resolveImagesForVariant(images, variantId);
  return gallery[0]?.url || null;
}

/**
 * Attach resolved galleries to a variant list in one pass (getMaster, PDP).
 * @param {Array} variants variant rows (lean ok)
 * @param {Array} images flat image rows for the master
 * @returns {Array} variants with { images, imageSource, primaryImageUrl }
 */
export function attachVariantGalleries(variants, images) {
  const { master, byVariant } = groupImagesByVariant(images);
  const masterSorted = master; // already sorted by groupImagesByVariant
  return (variants || []).map((v) => {
    const vk = idKey(v._id ?? v.id);
    const own = vk ? byVariant.get(vk) : null;
    const gallery = own ? sortGallery(own) : masterSorted;
    return {
      ...(typeof v.toObject === 'function' ? v.toObject() : { ...v }),
      images: gallery.map((g) => ({
        id: idKey(g._id ?? g.id),
        url: g.url,
        altText: g.altText || null,
        isPrimary: Boolean(g.isPrimary),
        sortOrder: g.sortOrder ?? 0,
      })),
      imageSource: own ? 'variant' : 'master',
      primaryImageUrl: gallery[0]?.url || null,
    };
  });
}

/** Human label for a variant: explicit displayLabel wins, else the raw value. */
export function variantDisplayLabel(variant) {
  if (!variant) return '';
  return variant.displayLabel || variant.value || '';
}

/**
 * Pick the default variant from a tenant's LISTED variants.
 * isDefault-listed first, then first in-stock, then first by sortOrder.
 * Pure over caller-supplied rows: [{ variant, listing, stockQty }].
 */
export function pickDefaultVariant(rows) {
  const list = [...(rows || [])];
  if (!list.length) return null;
  const bySort = (a, b) => (a.variant?.sortOrder ?? 0) - (b.variant?.sortOrder ?? 0)
    || String(a.variant?.value || '').localeCompare(String(b.variant?.value || ''));
  const listed = list.sort(bySort);
  return listed.find((r) => r.variant?.isDefault)
    || listed.find((r) => (r.stockQty ?? 0) > 0)
    || listed[0];
}

export default {
  idKey,
  isUsableImage,
  sortGallery,
  groupImagesByVariant,
  resolveImagesForVariant,
  primaryImageUrlFor,
  attachVariantGalleries,
  variantDisplayLabel,
  pickDefaultVariant,
};
