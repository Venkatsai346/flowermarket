import ProductMaster from '../models/productMaster.model.js';
import ProductImage from '../models/productImage.model.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import { ENTITY_STATUS } from '../constants/enums.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { literalRegex } from '../utils/regex.js';
import { updateWithVersion } from '../utils/catalog/optimisticLock.js';

const REFRESH_HOURS = 24;
const IMAGE_EDIT_FIELDS = ['altText', 'role', 'mimeType', 'width', 'height', 'fileSize', 'focalPoint', 'sortOrder'];

function familyStages({ search = '', issue = '', mediaType = 'image' } = {}) {
  const initialMatch = { isDeleted: { $ne: true } };
  if (search) initialMatch.$or = [
    { title: literalRegex(search) },
    { skuGlobal: literalRegex(search) },
  ];
  const stages = [
    { $match: initialMatch },
    {
      $lookup: {
        from: 'productimages', localField: '_id', foreignField: 'productMasterId', as: '_media',
        pipeline: [{ $match: { isDeleted: { $ne: true }, status: ENTITY_STATUS.ACTIVE, ...(mediaType ? { mediaType } : {}) } }],
      },
    },
    {
      $lookup: {
        from: 'productvariants', localField: '_id', foreignField: 'productMasterId', as: '_variants',
        pipeline: [{ $match: { isDeleted: { $ne: true }, status: ENTITY_STATUS.ACTIVE } }, { $project: { _id: 1, displayLabel: 1, value: 1, sku: 1 } }],
      },
    },
    {
      $set: {
        mediaCount: { $size: '$_media' },
        variantCount: { $size: '$_variants' },
        masterMedia: { $filter: { input: '$_media', as: 'asset', cond: { $eq: [{ $ifNull: ['$$asset.variantId', null] }, null] } } },
        missingAltCount: { $size: { $filter: { input: '$_media', as: 'asset', cond: { $lt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$$asset.altText', ''] } } } }, 5] } } } },
        unmeasuredCount: { $size: { $filter: { input: '$_media', as: 'asset', cond: { $or: [{ $not: ['$$asset.width'] }, { $not: ['$$asset.height'] }] } } } },
        lowResolutionCount: { $size: { $filter: { input: '$_media', as: 'asset', cond: { $and: ['$$asset.width', '$$asset.height', { $or: [{ $lt: ['$$asset.width', 800] }, { $lt: ['$$asset.height', 800] }] }] } } } },
      },
    },
    {
      $set: {
        masterMediaCount: { $size: '$masterMedia' },
        masterPrimaryCount: { $size: { $filter: { input: '$masterMedia', as: 'asset', cond: '$$asset.isPrimary' } } },
        variantMediaIds: { $setUnion: [{ $map: { input: { $filter: { input: '$_media', as: 'asset', cond: { $ne: [{ $ifNull: ['$$asset.variantId', null] }, null] } } }, as: 'asset', in: '$$asset.variantId' } }, []] },
        variantGalleryHealth: {
          $map: {
            input: '$_variants', as: 'variant', in: {
              mediaCount: { $size: { $filter: { input: '$_media', as: 'asset', cond: { $eq: ['$$asset.variantId', '$$variant._id'] } } } },
              primaryCount: { $size: { $filter: { input: '$_media', as: 'asset', cond: { $and: [{ $eq: ['$$asset.variantId', '$$variant._id'] }, '$$asset.isPrimary'] } } } },
            },
          },
        },
      },
    },
    {
      $set: {
        uncoveredVariantCount: {
          $cond: [
            { $gt: ['$masterMediaCount', 0] }, 0,
            { $size: { $filter: { input: '$_variants', as: 'variant', cond: { $not: [{ $in: ['$$variant._id', '$variantMediaIds'] }] } } } },
          ],
        },
        noMedia: { $eq: ['$mediaCount', 0] },
        primaryMissing: { $and: [{ $gt: ['$masterMediaCount', 0] }, { $eq: ['$masterPrimaryCount', 0] }] },
        primaryConflict: { $gt: ['$masterPrimaryCount', 1] },
        variantPrimaryMissingCount: { $size: { $filter: { input: '$variantGalleryHealth', as: 'gallery', cond: { $and: [{ $gt: ['$$gallery.mediaCount', 0] }, { $eq: ['$$gallery.primaryCount', 0] }] } } } },
        variantPrimaryConflictCount: { $size: { $filter: { input: '$variantGalleryHealth', as: 'gallery', cond: { $gt: ['$$gallery.primaryCount', 1] } } } },

      },
    },
    {
      $set: {
        blockerCount: { $add: [{ $cond: ['$noMedia', 1, 0] }, { $cond: ['$primaryMissing', 1, 0] }, { $cond: ['$primaryConflict', 1, 0] }, '$variantPrimaryMissingCount', '$variantPrimaryConflictCount'] },
        warningCount: { $add: ['$missingAltCount', '$unmeasuredCount', '$lowResolutionCount', '$uncoveredVariantCount'] },
        mediaScore: {
          $max: [0, {
            $subtract: [100, { $add: [
              { $cond: ['$noMedia', 45, 0] }, { $cond: ['$primaryMissing', 20, 0] }, { $cond: ['$primaryConflict', 20, 0] },
              { $multiply: ['$variantPrimaryMissingCount', 10] }, { $multiply: ['$variantPrimaryConflictCount', 10] },
              { $multiply: ['$missingAltCount', 5] }, { $multiply: ['$unmeasuredCount', 4] },
              { $multiply: ['$lowResolutionCount', 4] }, { $multiply: ['$uncoveredVariantCount', 6] },
            ] }],
          }],
        },
      },
    },
  ];
  const issueMatch = {
    no_media: { noMedia: true },
    no_primary: { $or: [{ primaryMissing: true }, { variantPrimaryMissingCount: { $gt: 0 } }] },
    primary_conflict: { $or: [{ primaryConflict: true }, { variantPrimaryConflictCount: { $gt: 0 } }] },
    missing_alt: { missingAltCount: { $gt: 0 } }, dimensions: { $or: [{ unmeasuredCount: { $gt: 0 } }, { lowResolutionCount: { $gt: 0 } }] },
    variant_coverage: { uncoveredVariantCount: { $gt: 0 } }, healthy: { blockerCount: 0, warningCount: 0 },
  }[issue];
  if (issueMatch) stages.push({ $match: issueMatch });
  return stages;
}

class CatalogMediaService {
  async summary() {
    const [result] = await ProductMaster.aggregate([
      ...familyStages(),
      {
        $group: {
          _id: null,
          families: { $sum: 1 }, assets: { $sum: '$mediaCount' }, noMedia: { $sum: { $cond: ['$noMedia', 1, 0] } },
          noPrimary: { $sum: { $add: [{ $cond: ['$primaryMissing', 1, 0] }, '$variantPrimaryMissingCount'] } },
          primaryConflicts: { $sum: { $add: [{ $cond: ['$primaryConflict', 1, 0] }, '$variantPrimaryConflictCount'] } },
          missingAlt: { $sum: '$missingAltCount' }, unmeasured: { $sum: '$unmeasuredCount' }, lowResolution: { $sum: '$lowResolutionCount' },
          uncoveredVariants: { $sum: '$uncoveredVariantCount' }, healthyFamilies: { $sum: { $cond: [{ $and: [{ $eq: ['$blockerCount', 0] }, { $eq: ['$warningCount', 0] }] }, 1, 0] } },
          averageScore: { $avg: '$mediaScore' }, evaluatedAt: { $max: '$updatedAt' },
        },
      },
    ]).allowDiskUse(true);
    return {
      families: result?.families || 0, assets: result?.assets || 0, noMedia: result?.noMedia || 0,
      noPrimary: result?.noPrimary || 0, primaryConflicts: result?.primaryConflicts || 0,
      missingAlt: result?.missingAlt || 0, unmeasured: result?.unmeasured || 0, lowResolution: result?.lowResolution || 0,
      uncoveredVariants: result?.uncoveredVariants || 0, healthyFamilies: result?.healthyFamilies || 0,
      averageScore: Math.round(result?.averageScore || 0), freshnessHours: REFRESH_HOURS,
    };
  }

  async listFamilies({ query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const sort = query.sort === 'newest' ? { updatedAt: -1, _id: 1 } : { blockerCount: -1, mediaScore: 1, warningCount: -1, _id: 1 };
    const [result] = await ProductMaster.aggregate([
      ...familyStages({ search: query.search, issue: query.issue }),
      { $sort: sort },
      {
        $facet: {
          items: [
            { $skip: (page - 1) * limit }, { $limit: limit },
            { $project: { _media: 0, _variants: 0, masterMedia: 0, variantMediaIds: 0, variantGalleryHealth: 0 } },
          ],
          count: [{ $count: 'value' }],
        },
      },
    ]).allowDiskUse(true);
    const total = result?.count?.[0]?.value || 0;
    return { items: result?.items || [], meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total } };
  }

  async updateAsset({ masterId, imageId, patch, expectedVersion, actorId = null, req = null }) {
    const master = await ProductMaster.findOne({ _id: masterId, isDeleted: { $ne: true } });
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    const image = await ProductImage.findOne({ _id: imageId, productMasterId: masterId, isDeleted: { $ne: true } });
    if (!image) throw notFound('Media asset not found on this master', 'IMAGE_NOT_FOUND');
    const before = {};
    for (const field of IMAGE_EDIT_FIELDS) {
      if (patch[field] !== undefined) { before[field] = image[field]; image[field] = patch[field]; }
    }
    image.updatedAt = new Date();
    image.updatedBy = actorId;
    await updateWithVersion(master, expectedVersion, { updatedAt: new Date(), updatedBy: actorId });
    await image.save();
    await auditService.record({ action: 'update', entityType: 'product_image', entityId: image.id, actorId, actorType: 'admin', before, after: Object.fromEntries(Object.keys(before).map((key) => [key, image[key]])), req });
    await catalogEventService.publish({ eventType: 'product_master_updated', entityType: 'product_master', entityId: master.id, payload: { id: master.id, imageUpdated: image.id, version: master.version } });
    return { asset: image, version: master.version };
  }

  async reorderGallery({ masterId, items, expectedVersion, actorId = null, req = null }) {
    const master = await ProductMaster.findOne({ _id: masterId, isDeleted: { $ne: true } });
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    const ids = items.map((item) => String(item.imageId));
    if (new Set(ids).size !== ids.length) throw badRequest('Gallery order contains duplicate assets', 'DUPLICATE_MEDIA_ASSET');
    const assets = await ProductImage.find({ _id: { $in: ids }, productMasterId: masterId, isDeleted: { $ne: true } }).select('_id');
    if (assets.length !== ids.length) throw badRequest('One or more assets do not belong to this master', 'MEDIA_SCOPE_MISMATCH');
    const updatedAt = new Date();
    await updateWithVersion(master, expectedVersion, { updatedAt, updatedBy: actorId });
    await ProductImage.bulkWrite(items.map((item) => ({ updateOne: { filter: { _id: item.imageId, productMasterId: masterId }, update: { $set: { sortOrder: item.sortOrder, updatedAt, updatedBy: actorId } } } })), { ordered: true });
    await auditService.record({ action: 'update', entityType: 'product_image', entityId: master.id, actorId, actorType: 'admin', after: { operation: 'reorder', assets: items.length }, req });
    await catalogEventService.publish({ eventType: 'product_master_updated', entityType: 'product_master', entityId: master.id, payload: { id: master.id, mediaReordered: true, version: master.version } });
    return { updated: items.length, version: master.version };
  }
}

export default new CatalogMediaService();
