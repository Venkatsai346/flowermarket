import mongoose from 'mongoose';
import ProductMaster from '../models/productMaster.model.js';
import ProductVariant from '../models/productVariant.model.js';
import ProductVariantAttributeValue from '../models/productVariantAttributeValue.model.js';
import ProductPackage from '../models/productPackage.model.js';
import ProductBundleComponent from '../models/productBundleComponent.model.js';
import ProductCompliance from '../models/productCompliance.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import categoryService from './category.service.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import { updateWithVersion } from '../utils/catalog/optimisticLock.js';
import { normalizeUnitPolicy, assertQuantity } from '../utils/catalog/unitConversion.js';
import { badRequest, conflict, notFound } from '../utils/ApiError.js';

const id = (value) => String(value?._id || value?.id || value || '');

class CatalogStructureService {
  async master(masterId) {
    const master = await ProductMaster.findById(masterId);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    return master;
  }

  async touch(master, expectedVersion) {
    await updateWithVersion(master, expectedVersion, {});
  }

  async publish(master, section, actorId, req, after) {
    await auditService.record({
      action: 'update', entityType: `product_${section}`, entityId: master.id,
      actorId, actorType: 'admin', after, req,
    });
    await catalogEventService.publish({
      eventType: 'product_master_updated', entityType: 'product_master', entityId: master.id,
      payload: { id: master.id, section, version: master.version },
    });
  }

  async replaceRows(Model, filter, docs) {
    const candidates = docs.map((doc) => new Model(doc));
    await Promise.all(candidates.map((doc) => doc.validate()));
    const previous = await Model.find(filter).lean();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Model.deleteMany(filter).session(session);
        if (docs.length) await Model.insertMany(docs, { session });
      });
    } catch (error) {
      const unsupported = /Transaction numbers are only allowed|replica set|does not support transactions/i.test(String(error?.message || error));
      if (!unsupported) throw error;
      try {
        await Model.deleteMany(filter);
        if (docs.length) await Model.insertMany(docs);
      } catch (writeError) {
        await Model.deleteMany(filter).catch(() => {});
        if (previous.length) await Model.insertMany(previous).catch(() => {});
        throw writeError;
      }
    } finally {
      await session.endSession();
    }
  }

  async setVariantAttributes({ masterId, variantId, attributes, expectedVersion, actorId, req }) {
    const master = await this.master(masterId);
    const variant = await ProductVariant.findOne({ _id: variantId, productMasterId: master.id });
    if (!variant) throw notFound('Variant not found on this master', 'VARIANT_NOT_FOUND');
    const { ok, errors } = await categoryService.validateAttributes(master.categoryId, attributes, { scope: 'variant' });
    if (!ok) throw badRequest('Variant attribute validation failed', 'VARIANT_ATTRIBUTE_ERROR', errors);
    await this.touch(master, expectedVersion);
    await this.replaceRows(
      ProductVariantAttributeValue,
      { productVariantId: variant.id },
      attributes.map((attribute, index) => ({
        productMasterId: master.id, productVariantId: variant.id,
        attributeKey: attribute.key, value: attribute.value, unit: attribute.unit || null, sortOrder: index,
      })),
    );
    await this.publish(master, 'variant_attribute', actorId, req, { variantId, count: attributes.length });
    return this.getStructures(master.id);
  }

  async replacePackages({ masterId, packages, expectedVersion, actorId, req }) {
    const master = await this.master(masterId);
    const unitPolicy = normalizeUnitPolicy(master.unitPolicy, master.defaultSellingUnit);
    const codes = packages.map((item) => item.code);
    if (new Set(codes).size !== codes.length) throw badRequest('Package codes must be unique', 'PACKAGE_CODE_DUPLICATE');
    const variantIds = [...new Set(packages.map((item) => item.variantId).filter(Boolean).map(String))];
    if (variantIds.length) {
      const count = await ProductVariant.countDocuments({ _id: { $in: variantIds }, productMasterId: master.id });
      if (count !== variantIds.length) throw badRequest('A package references a variant from another product', 'PACKAGE_VARIANT_INVALID');
    }
    for (const item of packages) assertQuantity(item.quantity, item.unitCode, unitPolicy);
    for (const item of packages) {
      if (item.containedPackageCode && !codes.includes(item.containedPackageCode)) throw badRequest('Contained package code does not exist', 'PACKAGE_PARENT_INVALID');
      const seen = new Set([item.code]);
      let next = item.containedPackageCode;
      while (next) {
        if (seen.has(next)) throw badRequest('Package hierarchy cannot contain a cycle', 'PACKAGE_CYCLE');
        seen.add(next);
        next = packages.find((entry) => entry.code === next)?.containedPackageCode;
      }
    }
    const idByCode = new Map(packages.map((item) => [item.code, new mongoose.Types.ObjectId()]));
    const docs = packages.map(({ containedPackageCode, ...item }) => ({
      ...item, _id: idByCode.get(item.code), productMasterId: master.id,
      containedPackageId: containedPackageCode ? idByCode.get(containedPackageCode) : null,
    }));
    await this.touch(master, expectedVersion);
    await this.replaceRows(ProductPackage, { productMasterId: master.id }, docs);
    await this.publish(master, 'package', actorId, req, { count: packages.length });
    return this.getStructures(master.id);
  }

  async reachesBundle(startMasterId, targetMasterId, replacementBundleId, replacementComponents) {
    const queue = [String(startMasterId)];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (current === String(targetMasterId)) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      let children;
      if (current === String(replacementBundleId)) children = replacementComponents.map((component) => component.componentMasterId);
      else {
        // Deliberately sequential graph traversal: each frontier depends on the previous component set.
        // eslint-disable-next-line no-await-in-loop
        children = (await ProductBundleComponent.find({ bundleMasterId: current, status: 'active' }).select('componentMasterId').lean())
          .map((component) => component.componentMasterId);
      }
      queue.push(...children.map(String));
      if (seen.size > 1000) throw badRequest('Bundle graph exceeds the integrity traversal limit', 'BUNDLE_GRAPH_TOO_LARGE');
    }
    return false;
  }

  async replaceBundleComponents({ masterId, components, expectedVersion, actorId, req }) {
    const master = await this.master(masterId);
    if (master.kind !== 'bundle') throw badRequest('Only bundle products can have components', 'NOT_A_BUNDLE');
    const componentIds = [...new Set(components.map((component) => String(component.componentMasterId)))];
    if (componentIds.includes(String(master.id))) throw badRequest('A bundle cannot include itself', 'BUNDLE_SELF_REFERENCE');
    const componentMasters = await ProductMaster.find({ _id: { $in: componentIds }, status: { $ne: 'deprecated' } });
    if (componentMasters.length !== componentIds.length) throw badRequest('Every bundle component must reference a live product', 'BUNDLE_COMPONENT_INVALID');
    const byId = new Map(componentMasters.map((component) => [String(component.id), component]));
    for (const component of components) {
      const componentMaster = byId.get(String(component.componentMasterId));
      assertQuantity(component.quantity, component.unitCode, normalizeUnitPolicy(componentMaster.unitPolicy, componentMaster.defaultSellingUnit));
      if (component.minSelections > component.maxSelections) throw badRequest('Bundle minimum selections cannot exceed maximum', 'BUNDLE_SELECTION_INVALID');
      if (component.componentVariantId) {
        // Component validation is sequential to report the exact invalid row deterministically.
        // eslint-disable-next-line no-await-in-loop
        const exists = await ProductVariant.exists({ _id: component.componentVariantId, productMasterId: component.componentMasterId, status: 'active' });
        if (!exists) throw badRequest('Bundle component variant does not belong to its product', 'BUNDLE_VARIANT_INVALID');
      }
      // Graph checks are deliberately sequential because each proposed edge is validated against the same replacement graph.
      // eslint-disable-next-line no-await-in-loop
      if (await this.reachesBundle(component.componentMasterId, master.id, master.id, components)) {
        throw badRequest('Bundle components would create a recursive cycle', 'BUNDLE_CYCLE');
      }
    }
    await this.touch(master, expectedVersion);
    await this.replaceRows(
      ProductBundleComponent,
      { bundleMasterId: master.id },
      components.map((component) => ({ ...component, bundleMasterId: master.id })),
    );
    await this.publish(master, 'bundle', actorId, req, { count: components.length });
    return this.getStructures(master.id);
  }

  async replaceCompliance({ masterId, records, expectedVersion, actorId, req }) {
    const master = await this.master(masterId);
    const variantIds = [...new Set(records.map((record) => record.variantId).filter(Boolean).map(String))];
    if (variantIds.length) {
      const count = await ProductVariant.countDocuments({ _id: { $in: variantIds }, productMasterId: master.id });
      if (count !== variantIds.length) throw badRequest('Compliance record references an invalid variant', 'COMPLIANCE_VARIANT_INVALID');
    }
    for (const record of records) {
      if (record.validFrom && record.validUntil && new Date(record.validUntil) <= new Date(record.validFrom)) {
        throw badRequest('Compliance expiry must be after its start date', 'COMPLIANCE_DATES_INVALID');
      }
      if (record.status === 'verified' && !record.documents?.length && !record.issuerReference) {
        throw badRequest('Verified compliance needs evidence or an issuer reference', 'COMPLIANCE_EVIDENCE_REQUIRED');
      }
    }
    await this.touch(master, expectedVersion);
    await this.replaceRows(
      ProductCompliance,
      { productMasterId: master.id },
      records.map((record) => ({ ...record, productMasterId: master.id })),
    );
    const requirementIssues = await this.complianceIssues(master);
    master.complianceStatus = requirementIssues.length
      ? 'pending' : records.some((record) => record.status === 'verified') ? 'compliant' : 'not_required';
    await master.save();
    await this.publish(master, 'compliance', actorId, req, { count: records.length, status: master.complianceStatus });
    return this.getStructures(master.id);
  }

  async complianceIssues(master) {
    const category = await categoryService.getById(master.categoryId);
    const requirements = (category.complianceRequirements || []).filter((requirement) => requirement.required !== false);
    if (!requirements.length) return [];
    const records = await ProductCompliance.find({ productMasterId: master.id, status: 'verified' }).lean();
    const now = new Date();
    return requirements.flatMap((requirement) => {
      const record = records.find((candidate) => candidate.code === requirement.code && candidate.type === requirement.type);
      if (!record) return [{ severity: 'error', code: 'COMPLIANCE_MISSING', message: `${requirement.label} is required.` }];
      if (record.validUntil && new Date(record.validUntil) <= now) return [{ severity: 'error', code: 'COMPLIANCE_EXPIRED', message: `${requirement.label} has expired.` }];
      if (requirement.requiresExpiry && !record.validUntil) return [{ severity: 'error', code: 'COMPLIANCE_EXPIRY_REQUIRED', message: `${requirement.label} needs an expiry date.` }];
      return [];
    });
  }

  async assertPublishable(master) {
    const issues = await this.complianceIssues(master);
    if (issues.length) throw conflict('Required product compliance is incomplete', 'PRODUCT_COMPLIANCE_REQUIRED', { issues });
  }

  async assertMasterDeprecatable(masterId) {
    const usedBy = await ProductBundleComponent.find({ componentMasterId: masterId, status: 'active' }).select('bundleMasterId').limit(20).lean();
    if (usedBy.length) throw conflict('Product is an active component of one or more bundles', 'PRODUCT_USED_BY_BUNDLE', { bundleMasterIds: usedBy.map((row) => row.bundleMasterId) });
  }

  async assertVariantRemovable(masterId, variantId) {
    const [listing, bundle, packageRow, compliance] = await Promise.all([
      TenantProduct.exists({ productMasterId: masterId, variantId }),
      ProductBundleComponent.exists({ componentVariantId: variantId }),
      ProductPackage.exists({ productMasterId: masterId, variantId }),
      ProductCompliance.exists({ productMasterId: masterId, variantId }),
    ]);
    const blockers = [listing && 'tenant listings', bundle && 'bundle components', packageRow && 'packaging', compliance && 'compliance records'].filter(Boolean);
    if (blockers.length) throw conflict(`Variant is referenced by ${blockers.join(', ')}`, 'VARIANT_IN_USE', { blockers });
  }

  async getStructures(masterId) {
    const [variantAttributes, packages, bundleComponents, compliance] = await Promise.all([
      ProductVariantAttributeValue.find({ productMasterId: masterId }).sort({ productVariantId: 1, sortOrder: 1 }).lean(),
      ProductPackage.find({ productMasterId: masterId }).sort({ sortOrder: 1 }).lean(),
      ProductBundleComponent.find({ bundleMasterId: masterId }).sort({ selectionGroup: 1, sortOrder: 1 }).lean(),
      ProductCompliance.find({ productMasterId: masterId }).sort({ type: 1, code: 1 }).lean(),
    ]);
    const [componentMasters, componentVariants] = await Promise.all([
      ProductMaster.find({ _id: { $in: bundleComponents.map((component) => component.componentMasterId) } }).select('title slug skuGlobal kind').lean(),
      ProductVariant.find({ _id: { $in: bundleComponents.map((component) => component.componentVariantId).filter(Boolean) } }).select('displayLabel value combinationKey').lean(),
    ]);
    const masterById = new Map(componentMasters.map((item) => [id(item), item]));
    const variantById = new Map(componentVariants.map((item) => [id(item), item]));
    const packageById = new Map(packages.map((item) => [id(item), item.code]));
    return {
      variantAttributes,
      packages: packages.map((item) => ({ ...item, containedPackageCode: packageById.get(id(item.containedPackageId)) || null })),
      bundleComponents: bundleComponents.map((component) => ({
        ...component,
        product: masterById.get(id(component.componentMasterId)) || null,
        variant: variantById.get(id(component.componentVariantId)) || null,
      })),
      compliance,
    };
  }

  async integrityReport(masterId) {
    const master = await this.master(masterId);
    const structures = await this.getStructures(master.id);
    const issues = [];
    const variants = await ProductVariant.find({ productMasterId: master.id, status: 'active' }).lean();
    if (master.options.length && variants.some((variant) => !variant.optionValues?.length)) issues.push({ severity: 'warning', code: 'LEGACY_VARIANT', message: 'Some variants still use legacy one-dimensional identity.' });
    if (master.kind === 'bundle' && !structures.bundleComponents.length) issues.push({ severity: 'error', code: 'EMPTY_BUNDLE', message: 'Bundle has no components.' });
    if (master.kind !== 'bundle' && structures.bundleComponents.length) issues.push({ severity: 'error', code: 'NON_BUNDLE_COMPONENTS', message: 'Non-bundle product owns bundle components.' });
    const expired = structures.compliance.filter((record) => record.validUntil && new Date(record.validUntil) <= new Date());
    if (expired.length) issues.push({ severity: 'error', code: 'COMPLIANCE_EXPIRED', message: `${expired.length} compliance record(s) expired.` });
    issues.push(...await this.complianceIssues(master));
    if (master.complianceStatus === 'compliant' && !structures.compliance.some((record) => record.status === 'verified')) issues.push({ severity: 'error', code: 'COMPLIANCE_STATUS_DRIFT', message: 'Compliance status has no verified evidence.' });
    const unitPolicy = normalizeUnitPolicy(master.unitPolicy, master.defaultSellingUnit);
    return {
      ok: !issues.some((issue) => issue.severity === 'error'),
      score: Math.max(0, 100 - issues.reduce((sum, issue) => sum + (issue.severity === 'error' ? 25 : 8), 0)),
      issues,
      counts: { variants: variants.length, packages: structures.packages.length, bundleComponents: structures.bundleComponents.length, compliance: structures.compliance.length },
      unitPolicy,
    };
  }
}

export default new CatalogStructureService();
