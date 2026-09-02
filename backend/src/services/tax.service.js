import TaxPolicy from '../models/taxPolicy.model.js';
import TaxRegistration from '../models/taxRegistration.model.js';
import StatutoryRate from '../models/statutoryRate.model.js';
import Tenant from '../models/tenant.model.js';
import Vendor from '../models/vendor.model.js';
import auditService from './audit.service.js';
import config from '../config/index.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';
import { isValidGstin, stateCodeFromGstin, stateCodeFromName, panFromGstin } from '../utils/gst.js';
import {
  TAX_OWNER_TYPE,
  TAX_NATURE_OF_SUPPLY,
  TAX_REGISTRATION_TYPE,
  STATUTORY_RATE_KIND,
  AUDIT_ACTION,
} from '../constants/enums.js';

/**
 * TaxService — resolves the LEGAL FACTS a tax document needs (Phase 6.2).
 *
 * The arithmetic lives in `utils/gst.js` (pure, exhaustively tested). This
 * service answers the questions that require the database:
 *   - what rate applied to this category ON THIS DATE?
 *   - who is the supplier, and what is their GSTIN and state?
 *   - what TCS/TDS rate was in force on this date?
 *
 * EFFECTIVE DATING IS THE WHOLE POINT. Every resolver takes an `at` date and
 * answers as of that moment, so re-rendering a two-year-old invoice produces
 * the numbers it produced then — not the numbers today's rate table would give.
 */
class TaxService {
  // -------------------------------------------------------------------------
  // rate resolution
  // -------------------------------------------------------------------------

  /**
   * The TaxPolicy in force for a category at a given instant.
   *
   * Replaces `TaxPolicy.findOne({ categoryId, isActive: true })`, which always
   * returns TODAY's rate and therefore silently re-prices history.
   */
  async resolveTaxPolicy({ categoryId, at = new Date() }) {
    if (!categoryId) return null;
    const when = new Date(at);

    // effective-dated row wins
    const dated = await TaxPolicy.findOne({
      categoryId,
      effectiveFrom: { $ne: null, $lte: when },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gt: when } }],
    }).sort({ effectiveFrom: -1 }).lean();
    if (dated) return dated;

    // fall back to the undated active row (Phase 3.5 data)
    return TaxPolicy.findOne({ categoryId, isActive: true }).lean();
  }

  /** Batch resolver — one query per distinct category instead of per line. */
  async resolveTaxPolicies({ categoryIds = [], at = new Date() }) {
    const unique = [...new Set(categoryIds.filter(Boolean).map(String))];
    const out = new Map();
    await Promise.all(unique.map(async (id) => {
      out.set(id, await this.resolveTaxPolicy({ categoryId: id, at }));
    }));
    return out;
  }

  /**
   * Normalise a policy row (or its absence) into the shape the engine wants.
   *
   * A category with NO policy is treated as `nil_rated`, not as "0% taxable":
   * the difference matters in GSTR-1, and silently taxing at 0% while calling
   * it taxable is exactly the kind of thing that fails an audit.
   */
  rateFromPolicy(policy) {
    if (!policy) {
      return { rateBps: 0, cessBps: 0, natureOfSupply: TAX_NATURE_OF_SUPPLY.NIL_RATED, hsnCode: null, taxPolicyId: null };
    }
    return {
      rateBps: policy.rateBps ?? Math.round((policy.gstSlabPct || 0) * 100),
      cessBps: policy.cessBps || 0,
      natureOfSupply: policy.natureOfSupply || TAX_NATURE_OF_SUPPLY.TAXABLE,
      hsnCode: policy.hsnCode || null,
      taxPolicyId: policy._id || null,
    };
  }

  async listPolicies({ query = {} }) {
    const q = {};
    if (query.categoryId) q.categoryId = query.categoryId;
    if (query.natureOfSupply) q.natureOfSupply = query.natureOfSupply;
    const docs = await TaxPolicy.find(q).sort({ categoryId: 1, effectiveFrom: -1 }).lean();
    return { items: serializeList(docs) };
  }

  /**
   * Create a new effective-dated rate row. Supersedes rather than edits: the
   * previous row is closed at the new row's start, so the history of which
   * rate applied when is preserved.
   */
  async upsertPolicy({ payload, actorId = null, req = null }) {
    const { categoryId, rateBps, gstSlabPct, hsnCode, natureOfSupply, cessBps, effectiveFrom } = payload;
    if (!categoryId) throw badRequest('categoryId is required', 'CATEGORY_REQUIRED');
    if (rateBps == null && gstSlabPct == null) throw badRequest('rateBps or gstSlabPct is required', 'RATE_REQUIRED');

    const from = effectiveFrom ? new Date(effectiveFrom) : new Date();
    const previous = await TaxPolicy.findOne({
      categoryId,
      $or: [{ effectiveTo: null }, { effectiveTo: { $gt: from } }],
    }).sort({ effectiveFrom: -1 });

    if (previous) {
      previous.effectiveTo = from;
      previous.isActive = false;
      await previous.save();
    }

    const created = await TaxPolicy.create({
      categoryId,
      rateBps: rateBps ?? Math.round(Number(gstSlabPct) * 100),
      gstSlabPct: gstSlabPct ?? Number(rateBps) / 100,
      cessBps: cessBps || 0,
      natureOfSupply: natureOfSupply || TAX_NATURE_OF_SUPPLY.TAXABLE,
      hsnCode: hsnCode || null,
      effectiveFrom: from,
      effectiveTo: null,
      isActive: true,
    });

    await auditService.record({
      action: AUDIT_ACTION.RATE_OVERRIDE,
      entityType: 'tax_policy',
      entityId: created._id,
      tenantId: null,
      actorId,
      actorType: 'admin',
      before: previous ? { rateBps: previous.rateBps, effectiveTo: previous.effectiveTo } : null,
      after: { rateBps: created.rateBps, natureOfSupply: created.natureOfSupply, effectiveFrom: from },
      req,
    }).catch(() => {});

    return created;
  }

  // -------------------------------------------------------------------------
  // registrations (who the supplier legally is)
  // -------------------------------------------------------------------------

  /**
   * Resolve the supplier for a line. A vendor sells as itself; otherwise the
   * store is the supplier. Falls back to a synthesised unregistered profile so
   * a document can always be produced (flagged, never silently "GSTIN-less").
   */
  async resolveSupplier({ tenantId, vendorId = null }) {
    if (vendorId) {
      const reg = await TaxRegistration.findOne({
        ownerType: TAX_OWNER_TYPE.VENDOR, ownerId: vendorId, status: 'active',
      }).lean();
      if (reg) return { registration: reg, supplierType: TAX_OWNER_TYPE.VENDOR };

      const vendor = await Vendor.findById(vendorId).lean();
      return {
        registration: this.syntheticRegistration({
          ownerType: TAX_OWNER_TYPE.VENDOR,
          ownerId: vendorId,
          legalName: vendor?.businessName || 'Vendor',
          gstin: vendor?.gstin || null,
        }),
        supplierType: TAX_OWNER_TYPE.VENDOR,
        synthetic: true,
      };
    }

    const reg = await TaxRegistration.findOne({
      ownerType: TAX_OWNER_TYPE.TENANT, ownerId: tenantId, status: 'active',
    }).lean();
    if (reg) return { registration: reg, supplierType: TAX_OWNER_TYPE.TENANT };

    const tenant = await Tenant.findById(tenantId).lean();
    return {
      registration: this.syntheticRegistration({
        ownerType: TAX_OWNER_TYPE.TENANT,
        ownerId: tenantId,
        legalName: tenant?.name || 'Store',
        gstin: null,
      }),
      supplierType: TAX_OWNER_TYPE.TENANT,
      synthetic: true,
    };
  }

  /** A minimal unregistered-supplier profile (never persisted). */
  syntheticRegistration({ ownerType, ownerId, legalName, gstin = null }) {
    return {
      ownerType,
      ownerId,
      legalName,
      tradeName: legalName,
      gstin: gstin && isValidGstin(gstin) ? gstin : null,
      stateCode: (gstin && stateCodeFromGstin(gstin)) || config.tax.defaultStateCode,
      address: {},
      contact: {},
      registrationType: TAX_REGISTRATION_TYPE.UNREGISTERED,
      turnoverBand: 'lt_5cr',
      einvoiceEnabled: false,
      _synthetic: true,
    };
  }

  async getRegistration({ ownerType, ownerId = null }) {
    return TaxRegistration.findOne({ ownerType, ownerId }).lean();
  }

  /**
   * Create or update a registration. The GSTIN checksum is validated locally:
   * a wrong GSTIN on an ISSUED invoice can only be fixed with a credit note,
   * so rejecting the typo at entry is far cheaper than correcting it later.
   */
  async upsertRegistration({ ownerType, ownerId = null, payload, actorId = null, req = null }) {
    if (!Object.values(TAX_OWNER_TYPE).includes(ownerType)) {
      throw badRequest(`Unknown owner type: ${ownerType}`, 'BAD_OWNER_TYPE');
    }

    const gstin = payload.gstin ? String(payload.gstin).toUpperCase().trim() : null;
    if (gstin && !isValidGstin(gstin)) {
      throw badRequest('GSTIN failed format or checksum validation', 'INVALID_GSTIN', { gstin });
    }

    const stateCode = gstin
      ? stateCodeFromGstin(gstin)
      : (payload.stateCode || stateCodeFromName(payload.address?.state) || config.tax.defaultStateCode);

    const before = await TaxRegistration.findOne({ ownerType, ownerId }).lean();

    const doc = await TaxRegistration.findOneAndUpdate(
      { ownerType, ownerId },
      {
        $set: {
          legalName: payload.legalName,
          tradeName: payload.tradeName || payload.legalName,
          gstin,
          pan: payload.pan || (gstin ? panFromGstin(gstin) : null),
          stateCode,
          address: payload.address || {},
          contact: payload.contact || {},
          registrationType: gstin
            ? (payload.registrationType || TAX_REGISTRATION_TYPE.REGULAR)
            : TAX_REGISTRATION_TYPE.UNREGISTERED,
          turnoverBand: payload.turnoverBand || 'lt_5cr',
          einvoiceEnabled: Boolean(payload.einvoiceEnabled),
          invoiceFooter: payload.invoiceFooter ?? null,
          invoiceTerms: payload.invoiceTerms ?? null,
          signatureUrl: payload.signatureUrl ?? null,
          status: payload.status || 'active',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await auditService.record({
      action: AUDIT_ACTION.TAX_REGISTRATION_UPDATE,
      entityType: 'tax_registration',
      entityId: doc._id,
      tenantId: ownerType === TAX_OWNER_TYPE.TENANT ? ownerId : null,
      actorId,
      actorType: 'admin',
      before: before ? { gstin: before.gstin, legalName: before.legalName, stateCode: before.stateCode } : null,
      after: { gstin: doc.gstin, legalName: doc.legalName, stateCode: doc.stateCode },
      req,
    }).catch(() => {});

    return doc;
  }

  // -------------------------------------------------------------------------
  // statutory rates (TCS / TDS) — data, resolved by supply date
  // -------------------------------------------------------------------------

  async resolveStatutoryRate({ kind, at = new Date() }) {
    const when = new Date(at);
    const row = await StatutoryRate.findOne({
      kind,
      effectiveFrom: { $lte: when },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gt: when } }],
    }).sort({ effectiveFrom: -1 }).lean();
    return row || null;
  }

  async listStatutoryRates({ kind = null }) {
    const q = kind ? { kind } : {};
    return { items: serializeList(await StatutoryRate.find(q).sort({ kind: 1, effectiveFrom: -1 }).lean()) };
  }

  async createStatutoryRate({ payload, actorId = null, req = null }) {
    const { kind, rateBps, appliesTo, effectiveFrom, notificationRef, note } = payload;
    if (!Object.values(STATUTORY_RATE_KIND).includes(kind)) {
      throw badRequest(`Unknown statutory rate kind: ${kind}`, 'BAD_RATE_KIND');
    }
    const from = effectiveFrom ? new Date(effectiveFrom) : new Date();

    // close the currently-open row so the timeline has no overlap
    await StatutoryRate.updateMany(
      { kind, $or: [{ effectiveTo: null }, { effectiveTo: { $gt: from } }] },
      { $set: { effectiveTo: from } }
    );

    const created = await StatutoryRate.create({
      kind,
      rateBps,
      appliesTo: appliesTo || (kind === STATUTORY_RATE_KIND.TCS_GST_52 ? 'net_taxable' : 'gross_sales'),
      effectiveFrom: from,
      effectiveTo: null,
      notificationRef: notificationRef || null,
      note: note || null,
      createdByUserId: actorId,
    });

    await auditService.record({
      action: AUDIT_ACTION.RATE_OVERRIDE,
      entityType: 'statutory_rate',
      entityId: created._id,
      actorId,
      actorType: 'admin',
      after: { kind, rateBps, effectiveFrom: from, notificationRef },
      req,
    }).catch(() => {});

    return created;
  }

  /**
   * Seed a starting statutory-rate timeline. Idempotent (skips when rows for
   * the kind already exist). VALUES MUST BE CONFIRMED WITH A CA — they are
   * here so the system boots with a resolvable timeline, not as tax advice.
   */
  async seedStatutoryRates() {
    const existing = await StatutoryRate.countDocuments({});
    if (existing > 0) return { seeded: 0, skipped: true };
    await StatutoryRate.create([
      {
        kind: STATUTORY_RATE_KIND.TCS_GST_52,
        rateBps: 50, // 0.50% — VERIFY: revised by notification; effective-dated on purpose
        appliesTo: 'net_taxable',
        effectiveFrom: new Date('2024-07-10T00:00:00Z'),
        notificationRef: 'CGST s.52 — confirm the current notification with your CA',
        note: 'Seed value. Add a new row (never edit this one) when the rate changes.',
      },
      {
        kind: STATUTORY_RATE_KIND.TDS_194O,
        rateBps: 10, // 0.10% — VERIFY
        appliesTo: 'gross_sales',
        effectiveFrom: new Date('2024-10-01T00:00:00Z'),
        notificationRef: 'IT Act s.194-O — confirm the current rate with your CA',
        note: 'Seed value. Add a new row (never edit this one) when the rate changes.',
      },
    ]);
    return { seeded: 2, skipped: false };
  }
}

export default new TaxService();
