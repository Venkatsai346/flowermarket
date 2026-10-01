/**
 * Global catalog media operations indexes.
 *
 * Supports master/variant gallery hydration, active-media quality scans and
 * deterministic primary/sort ordering when production auto-indexing is off.
 */

export async function up(db) {
  const media = db.collection('productimages');
  await media.createIndex(
    { productMasterId: 1, status: 1, isDeleted: 1, mediaType: 1, variantId: 1, isPrimary: -1, sortOrder: 1 },
    { name: 'media_operations_gallery_idx', background: true },
  );
  await media.createIndex(
    { status: 1, isDeleted: 1, mediaType: 1, updatedAt: -1 },
    { name: 'media_operations_quality_scan_idx', background: true },
  );
}

export default { up };
