/**
 * Bootstrap script — creates the default tenant + auth config + demo data.
 * Run: npm run seed   (requires a running MongoDB, see .env MONGODB_URI)
 */
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import Tenant from '../src/models/tenant.model.js';
import TenantAuthConfig from '../src/models/tenantAuthConfig.model.js';
import User from '../src/models/user.model.js';
import ServiceablePincode from '../src/models/serviceablePincode.model.js';
import Location from '../src/models/location.model.js';
import Category from '../src/models/category.model.js';
import Brand from '../src/models/brand.model.js';
import ProductMaster from '../src/models/productMaster.model.js';
import ProductVariant from '../src/models/productVariant.model.js';
import ProductAttributeValue from '../src/models/productAttributeValue.model.js';
import TenantProduct from '../src/models/tenantProduct.model.js';
import Inventory from '../src/models/inventory.model.js';
import Hub from '../src/models/hub.model.js';
import DeliveryFeePolicy from '../src/models/deliveryFeePolicy.model.js';
import TaxPolicy from '../src/models/taxPolicy.model.js';
import TenantRefundPolicy from '../src/models/tenantRefundPolicy.model.js';
import DiscountPolicy from '../src/models/discountPolicy.model.js';
import slotService from '../src/services/slot.service.js';
import { USER_ROLES, LOGIN_METHOD, PRODUCT_TYPE, SELLING_UNIT } from '../src/constants/enums.js';

async function seed() {
  if (mongoose.connection.readyState !== 1) {
    await connectDb();
  }
  console.log('Seeding...');

  // ---- default tenant: your flower market ----
  let tenant = await Tenant.findOne({ slug: 'flower-market' });
  if (!tenant) {
    tenant = await Tenant.create({
      name: 'Flower Market',
      slug: 'flower-market',
      type: 'business',
      contactEmail: 'hello@flowermarket.in',
      plan: 'pro',
      status: 'active',
      features: { slotsEnabled: true, paymentsEnabled: true, marketplaceEnabled: false },
    });
    console.log(`Tenant created: ${tenant.slug} (${tenant.id})`);
  } else {
    console.log(`Tenant exists: ${tenant.slug} (${tenant.id})`);
  }

  // ---- auth config ----
  await TenantAuthConfig.updateOne(
    { tenantId: tenant.id },
    { $setOnInsert: { allowedLoginMethods: [LOGIN_METHOD.PHONE_OTP], otpLength: 6, status: 'active' } },
    { upsert: true }
  );
  console.log('Auth config ensured');

  // ---- demo admin ----
  const admin = await User.findOne({ tenantId: tenant.id, 'email.address': 'admin@flowermarket.in' });
  if (!admin) {
    const adminUser = await User.create({
      tenantId: tenant.id,
      phone: { countryCode: '+91', number: '9000000001', verified: true },
      email: { address: 'admin@flowermarket.in', verified: true },
      role: USER_ROLES.SUPER_ADMIN,
      status: 'active',
      profile: { firstName: 'Store', lastName: 'Admin' },
      loginMethods: [LOGIN_METHOD.PHONE_OTP, LOGIN_METHOD.EMAIL_PASSWORD],
    });
    await adminUser.setPassword('Admin@12345');
    await adminUser.save();
    console.log('Demo admin created: admin@flowermarket.in / Admin@12345');
  }

  // ---- sample locations (Andhra Pradesh pins) ----
  const ap = await Location.findOneAndUpdate(
    { type: 'state', code: 'AP' },
    { $setOnInsert: { name: 'Andhra Pradesh', code: 'AP', type: 'state', countryCode: 'IN', status: 'active' } },
    { upsert: true, new: true }
  );
  const city = await Location.findOneAndUpdate(
    { type: 'city', name: 'Kakinada' },
    { $setOnInsert: { name: 'Kakinada', type: 'city', countryCode: 'IN', parentId: ap.id, parentType: 'state', status: 'active' } },
    { upsert: true, new: true }
  );

  // ---- serviceable pincodes ----
  for (const pin of ['533001', '533002', '533003', '533004']) {
    await ServiceablePincode.updateOne(
      { tenantId: tenant.id, pincode: pin },
      { $setOnInsert: { isServiceable: true, deliveryTypes: ['standard', 'same_day'], status: 'active' } },
      { upsert: true }
    );
  }
  console.log('Serviceable pincodes ensured: 533001-533004');

  // ---- Phase 3: hub + slots (slotted delivery) ----
  let hub = await Hub.findOne({ tenantId: tenant.id, code: 'KAK-01' });
  if (!hub) {
    hub = await Hub.create({
      tenantId: tenant.id,
      name: 'Kakinada Dark Store',
      code: 'KAK-01',
      address: { line1: 'Plot 12, Ganjam Road', city: 'Kakinada', state: 'Andhra Pradesh', pincode: '533001' },
      serviceablePincodes: ['533001', '533002', '533003', '533004'],
      defaultSlotCapacity: 25,
      isActive: true,
    });
    console.log(`Hub created: ${hub.code} (${hub.id})`);
  } else {
    console.log(`Hub exists: ${hub.code} (${hub.id})`);
  }
  // link pincodes to the hub so resolveHub picks it up
  await ServiceablePincode.updateMany(
    { tenantId: tenant.id, pincode: { $in: ['533001', '533002', '533003', '533004'] } },
    { $set: { hubId: hub.id } }
  );
  // slots for the next 3 days (upsert; existing reserved counts preserved)
  const from = new Date();
  const to = new Date(Date.now() + 2 * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const gen = await slotService.generateForDates({
    tenantId: tenant.id, hubId: hub.id,
    fromDate: iso(from), toDate: iso(to), capacity: 25,
  });
  console.log(`Delivery slots ensured: ${gen.created} created for ${gen.window.fromDate}..${gen.window.toDate}`);

  // ---- Phase 3.5: pricing policies (replaces the hardcoded 49) ----
  const feePolicy = await DeliveryFeePolicy.findOne({ tenantId: tenant.id, isActive: true });
  if (!feePolicy) {
    await DeliveryFeePolicy.create({
      tenantId: tenant.id,
      name: 'default',
      baseFee: 49,
      freeDeliveryThreshold: 499, // cart >= ₹499 -> free delivery
      expressSurgeMultiplier: 1.25,
      distanceFeePerKm: 0,
      isActive: true,
      version: 1,
    });
    console.log('Delivery fee policy created: base ₹49, free ≥ ₹499');
  } else {
    console.log('Delivery fee policy exists');
  }

  // refund fee policy (fee refunded on FULL returns only, 100%)
  const refundPol = await TenantRefundPolicy.findOne({ tenantId: tenant.id });
  if (!refundPol) {
    await TenantRefundPolicy.create({
      tenantId: tenant.id,
      refundDeliveryFeeWhen: 'full_order_return_only',
      refundFeePct: 100,
    });
    console.log('Tenant refund policy created: fee refunded on full-order returns');
  }

  // demo coupon (WELCOME10: 10% off, max ₹100, min cart ₹199)
  const coupon = await DiscountPolicy.findOne({ tenantId: tenant.id, code: 'WELCOME10' });
  if (!coupon) {
    await DiscountPolicy.create({
      tenantId: tenant.id, code: 'WELCOME10',
      discountType: 'percent', value: 10,
      minCartValue: 199, maxDiscountCap: 100,
      validFrom: new Date(Date.now() - 86400000),
      validTo: new Date(Date.now() + 90 * 86400000),
      status: 'active', isActive: true,
    });
    console.log('Coupon created: WELCOME10 (10% off, max ₹100, min ₹199)');
  }

  // ---- demo rider (so the rider app flow works out of the box) ----
  const rider = await User.findOne({ tenantId: tenant.id, 'phone.number': '9000000009' });
  if (!rider) {
    await User.create({
      tenantId: tenant.id,
      phone: { countryCode: '+91', number: '9000000009', verified: true },
      role: USER_ROLES.RIDER,
      status: 'active',
      profile: { firstName: 'Demo', lastName: 'Rider' },
      rider: { availability: 'available', currentHubId: hub.id },
    });
    console.log('Demo rider created: +91 9000000009 (rider)');
  }

  // ---- catalog demo: categories / brand / masters / listings / inventory ----
  const catFresh = await Category.updateOne(
    { slug: 'fresh-flowers' },
    {
      $setOnInsert: {
        name: 'Fresh Flowers', slug: 'fresh-flowers', level: 0,
        attributeSchema: [
          { key: 'vase_life_days', label: 'Vase life (days)', type: 'number', required: true, min: 1, max: 30 },
          { key: 'color', label: 'Color', type: 'select', required: true, options: ['red', 'white', 'yellow', 'mixed'] },
        ],
        status: 'active', sortOrder: 1,
      },
    },
    { upsert: true }
  );
  const catBouquet = await Category.updateOne(
    { slug: 'bouquets' },
    { $setOnInsert: { name: 'Bouquets', slug: 'bouquets', level: 0, status: 'active', sortOrder: 2 } },
    { upsert: true }
  );
  const catPlants = await Category.updateOne(
    { slug: 'plants' },
    { $setOnInsert: { name: 'Plants', slug: 'plants', level: 0, status: 'active', sortOrder: 3 } },
    { upsert: true }
  );
  const brand = await Brand.updateOne(
    { slug: 'green-thumb' },
    { $setOnInsert: { name: 'Green Thumb', slug: 'green-thumb', status: 'active', verification: { status: 'verified', isVerified: true, verifiedAt: new Date() } } },
    { upsert: true }
  );
  const [freshCat, bouqCat, plantCat, brandDoc] = await Promise.all([
    Category.findOne({ slug: 'fresh-flowers' }),
    Category.findOne({ slug: 'bouquets' }),
    Category.findOne({ slug: 'plants' }),
    Brand.findOne({ slug: 'green-thumb' }),
  ]);

  const seedMaster = async ({ skuGlobal, type, title, categoryId, attributes, variants = [], stockQty, mrp, sellingPrice }) => {
    let master = await ProductMaster.findOne({ skuGlobal });
    if (!master) {
      master = await ProductMaster.create({
        skuGlobal, type, title,
        slug: skuGlobal.toLowerCase().replace(/_/g, '-'),
        categoryId, brandId: brandDoc._id,
        status: 'active',
        isPerishable: type === PRODUCT_TYPE.FRESH_FLOWER,
        defaultSellingUnit: SELLING_UNIT.BUNCH,
        review: { submittedAt: new Date(), reviewedAt: new Date() },
        searchText: `${title} ${type} ${skuGlobal}`.toLowerCase(),
      });
      if (attributes?.length) {
        await ProductAttributeValue.insertMany(
          attributes.map((a, i) => ({ productMasterId: master._id, attributeKey: a.key, value: a.value, unit: a.unit || null, sortOrder: i }))
        );
      }
      for (const v of variants) {
        await ProductVariant.create({ productMasterId: master._id, variantType: v.variantType, value: v.value, displayLabel: v.displayLabel || v.value, status: 'active' });
      }
    }
    let listing = await TenantProduct.findOne({ tenantId: tenant._id, productMasterId: master._id });
    if (!listing) {
      listing = await TenantProduct.create({
        tenantId: tenant._id, productMasterId: master._id,
        price: { mrp, sellingPrice, currency: 'INR' },
        stockQty, status: 'active',
        availability: { status: stockQty > 0 ? 'in_stock' : 'out_of_stock', updatedAt: new Date() },
      });
      await Inventory.create({
        tenantId: tenant._id, tenantProductId: listing._id,
        qtyOnHand: stockQty, qtyReserved: 0, lastUpdatedAt: new Date(),
      });
    }
    return master;
  };

  await seedMaster({
    skuGlobal: 'ROS-RED-BUNCH', type: PRODUCT_TYPE.FRESH_FLOWER, title: 'Red Roses (Bunch of 20)',
    categoryId: freshCat._id, attributes: [{ key: 'vase_life_days', value: '7' }, { key: 'color', value: 'red' }],
    stockQty: 120, mrp: 349, sellingPrice: 299,
  });
  await seedMaster({
    skuGlobal: 'ROS-WHITE-BUNCH', type: PRODUCT_TYPE.FRESH_FLOWER, title: 'White Roses (Bunch of 20)',
    categoryId: freshCat._id, attributes: [{ key: 'vase_life_days', value: '7' }, { key: 'color', value: 'white' }],
    stockQty: 80, mrp: 349, sellingPrice: 299,
  });
  await seedMaster({
    skuGlobal: 'MARIGOLD-1KG', type: PRODUCT_TYPE.FRESH_FLOWER, title: 'Marigold Loose (1 kg)',
    categoryId: freshCat._id, attributes: [{ key: 'vase_life_days', value: '3' }, { key: 'color', value: 'mixed' }],
    stockQty: 200, mrp: 220, sellingPrice: 179,
  });
  await seedMaster({
    skuGlobal: 'BOUQ-ROSES-10', type: PRODUCT_TYPE.FLOWER_BOUQUET, title: 'Roses Bouquet (10 stems, wrap)',
    categoryId: bouqCat._id, variants: [{ variantType: 'stem_count', value: '10 stems', displayLabel: '10 stems' }, { variantType: 'stem_count', value: '20 stems', displayLabel: '20 stems' }],
    stockQty: 45, mrp: 599, sellingPrice: 499,
  });
  await seedMaster({
    skuGlobal: 'PLT-MONEYPLANT', type: PRODUCT_TYPE.PLANT, title: 'Money Plant (pot)',
    categoryId: plantCat._id, stockQty: 60, mrp: 249, sellingPrice: 199,
  });
  console.log('Catalog demo data seeded: 5 products across 3 categories');

  // ---- GST per category (legal classification — must run AFTER categories
  //      exist; tax is computed on the pre-discount line total) ----
  const gstBySlug = { 'fresh-flowers': [5, '0603'], bouquets: [12, '0603'], plants: [5, '0602'] };
  for (const slug of Object.keys(gstBySlug)) {
    const cat = await Category.findOne({ slug });
    if (cat) {
      const [slab, hsn] = gstBySlug[slug];
      const existing = await TaxPolicy.findOne({ categoryId: cat.id, isActive: true });
      if (!existing) {
        await TaxPolicy.create({ categoryId: cat.id, gstSlabPct: slab, hsnCode: hsn, isActive: true });
      }
    }
  }
  console.log('Tax policies ensured (fresh-flowers 5%, bouquets 12%, plants 5%)');

  // ---- Phase 4b: platform-default notification templates (tenantId null) ----
  const { default: NotificationTemplate } = await import('../src/models/notificationTemplate.model.js');
  const defaults = [
    {
      code: 'order_confirmed', eventType: 'order_confirmed', channels: ['push', 'email', 'sms'],
      content: {
        push: { subject: 'Order confirmed 🎉', body: 'Hi {{firstName}}, your order {{orderNumber}} for ₹{{total}} is confirmed. Slot: {{slot}}.' },
        email: { subject: 'Order {{orderNumber}} confirmed', body: 'Hi {{firstName}},\n\nYour order {{orderNumber}} (₹{{total}}) is confirmed for {{slot}}. We will keep you posted on delivery.' },
        sms: { body: 'Order {{orderNumber}} confirmed (₹{{total}}), slot {{slot}}. Track live in the app.' },
      },
      priority: 'high',
    },
    {
      code: 'order_out_for_delivery', eventType: 'order_out_for_delivery', channels: ['push', 'sms'],
      content: {
        push: { subject: 'Out for delivery 🚚', body: 'Your order {{orderNumber}} is out for delivery. Fresh flowers incoming!' },
        sms: { body: 'Order {{orderNumber}} is out for delivery. Fresh flowers incoming!' },
      },
      priority: 'high',
    },
    {
      code: 'rider_arrived', eventType: 'rider_arrived', channels: ['push'],
      content: { push: { subject: 'Rider arrived 📍', body: 'Your rider is at the door for order {{orderNumber}}. Enjoy your blooms 🌷' } },
      priority: 'high',
    },
    {
      code: 'order_delivered', eventType: 'order_delivered', channels: ['push', 'email', 'sms'],
      content: {
        push: { subject: 'Delivered ✅', body: 'Order {{orderNumber}} delivered. Rate your experience — your feedback keeps us blooming!' },
        email: { subject: 'Order {{orderNumber}} delivered', body: 'Hi {{firstName}},\n\nYour order {{orderNumber}} has been delivered. Thank you for choosing Flower Market!' },
        sms: { body: 'Order {{orderNumber}} delivered. Thank you for choosing Flower Market!' },
      },
    },
    {
      code: 'order_cancelled', eventType: 'order_cancelled', channels: ['push', 'email'],
      content: {
        push: { subject: 'Order cancelled', body: 'Order {{orderNumber}} was cancelled. Refund initiated on your payment method.' },
        email: { subject: 'Order {{orderNumber}} cancelled', body: 'Hi {{firstName}},\n\nOrder {{orderNumber}} has been cancelled. Any refund is processed back to your original payment method.' },
      },
      priority: 'high',
    },
    {
      code: 'payment_failed', eventType: 'payment_failed', channels: ['push', 'sms'],
      content: {
        push: { subject: 'Payment failed ⚠️', body: 'Payment for order {{orderNumber}} (₹{{total}}) failed. Please retry to keep your slot.' },
        sms: { body: 'Payment for order {{orderNumber}} (₹{{total}}) failed. Retry in the app to keep your slot.' },
      },
      priority: 'urgent',
    },
    {
      code: 'refund_processed', eventType: 'refund_completed', channels: ['push', 'email', 'sms'],
      content: {
        push: { subject: 'Refund processed 💸', body: 'Your refund of ₹{{refundAmount}} for order {{orderNumber}} has been processed. It may take 3-5 days to reflect.' },
        email: { subject: 'Refund of ₹{{refundAmount}} processed', body: 'Hi {{firstName}},\n\nYour refund of ₹{{refundAmount}} for order {{orderNumber}} has been processed.' },
        sms: { body: 'Refund of ₹{{refundAmount}} for order {{orderNumber}} processed. 3-5 days to reflect.' },
      },
      priority: 'high',
    },
  ];
  for (const t of defaults) {
    await NotificationTemplate.updateOne(
      { tenantId: null, code: t.code },
      { $setOnInsert: { ...t, isActive: true, version: 1 } },
      { upsert: true }
    );
  }
  console.log(`Platform notification templates ensured (${defaults.length})`);

  // ---- Phase 5: marketplace plan catalog (idempotent) ----
  const { default: planService } = await import('../src/services/plan.service.js');
  const plansCreated = await planService.ensureDefaults();
  console.log(`Marketplace plans ensured (created: ${plansCreated.length ? plansCreated.join(', ') : 'none — all present'})`);

  console.log('Seed complete ✅  Set DEFAULT_TENANT_ID=' + tenant.id + ' in .env');
  return tenant.id;
}

/**
 * Reusable seed body for the live demo server (dev-server.mjs) — assumes
 * mongoose is ALREADY connected to the target DB and models are initialized.
 */
export async function runSeed() {
  return seed();
}

// CLI: connect then seed then exit.
if (process.argv[1] && process.argv[1].endsWith('seed-default-tenant.js')) {
  seed()
    .then(() => { disconnectDb(); process.exit(0); })
    .catch((err) => { console.error('Seed failed:', err); process.exit(1); });
}
