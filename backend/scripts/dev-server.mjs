/**
 * Live demo server — boots the API against an in-memory MongoDB so you can poke
 * it from the browser without installing MongoDB.
 *
 *   node scripts/dev-server.mjs
 *
 * - seeds a default tenant, auth config and serviceable pincodes automatically
 * - OTP provider = console: OTP codes are printed to the server console
 * - serves a landing page at / describing how to exercise the API
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import config from '../src/config/index.js';
import Tenant from '../src/models/tenant.model.js';
import TenantAuthConfig from '../src/models/tenantAuthConfig.model.js';
import ServiceablePincode from '../src/models/serviceablePincode.model.js';

const PORT = process.env.PORT || 4000;

async function main() {
  const mongod = await MongoMemoryServer.create({
    instance: { args: ['--wiredTigerCacheSizeGB', '0.25'] },
  });
  config.mongoUri = mongod.getUri('flower_market_demo');
  await mongoose.connect(config.mongoUri, { autoIndex: false });
  await Promise.all([
    Tenant.init(),
    TenantAuthConfig.init(),
    ServiceablePincode.init(),
    (await import('../src/models/user.model.js')).default.init(),
    (await import('../src/models/address.model.js')).default.init(),
    (await import('../src/models/authToken.model.js')).default.init(),
    (await import('../src/models/otpVerification.model.js')).default.init(),
    // ---- Phase 4: admin dashboard collections ----
    (await import('../src/models/inventoryAdjustment.model.js')).default.init(),
    (await import('../src/models/analyticsDaily.model.js')).default.init(),
    // ---- Phase 4b: notifications & exports collections ----
    (await import('../src/models/device.model.js')).default.init(),
    (await import('../src/models/notificationTemplate.model.js')).default.init(),
    (await import('../src/models/notification.model.js')).default.init(),
    (await import('../src/models/exportJob.model.js')).default.init(),
    (await import('../src/models/exportArtifact.model.js')).default.init(),
    // ---- Phase 5: multi-tenant marketplace collections ----
    (await import('../src/models/plan.model.js')).default.init(),
    (await import('../src/models/subscription.model.js')).default.init(),
    (await import('../src/models/invoice.model.js')).default.init(),
    (await import('../src/models/vendorApplication.model.js')).default.init(),
    (await import('../src/models/vendor.model.js')).default.init(),
    (await import('../src/models/platformDaily.model.js')).default.init(),
    (await import('../src/models/counter.model.js')).default.init(),
    // ---- Media uploads (images & videos) ----
    (await import('../src/models/mediaAsset.model.js')).default.init(),
    // ---- Phase 6.1: financial ledger ----
    (await import('../src/models/ledgerAccount.model.js')).default.init(),
    (await import('../src/models/ledgerJournal.model.js')).default.init(),
    (await import('../src/models/ledgerEntry.model.js')).default.init(),
    (await import('../src/models/accountBalance.model.js')).default.init(),
    // ---- Phase 6.2: GST / tax invoicing ----
    (await import('../src/models/taxRegistration.model.js')).default.init(),
    (await import('../src/models/statutoryRate.model.js')).default.init(),
    (await import('../src/models/taxDocumentSeries.model.js')).default.init(),
    (await import('../src/models/taxDocument.model.js')).default.init(),
    // ---- Phase 6.3: vendor payouts ----
    (await import('../src/models/payoutPolicy.model.js')).default.init(),
    (await import('../src/models/vendorPayoutAccount.model.js')).default.init(),
    (await import('../src/models/payoutLineItem.model.js')).default.init(),
    (await import('../src/models/payoutBatch.model.js')).default.init(),
    (await import('../src/models/payoutStatusHistory.model.js')).default.init(),
    (await import('../src/models/payoutAdjustment.model.js')).default.init(),
    // ---- Phase 6.4/6.5: domains + search ----
    (await import('../src/models/tenantDomain.model.js')).default.init(),
    (await import('../src/models/searchDocument.model.js')).default.init(),
    (await import('../src/models/rankingProfile.model.js')).default.init(),
    (await import('../src/models/searchSynonym.model.js')).default.init(),
  ]);

  // ---- Phase 6.1: chart of accounts ----
  await (await import('../src/services/ledger.service.js')).default.ensureChartOfAccounts();
  // ---- Phase 6.2: statutory rate timeline ----
  await (await import('../src/services/tax.service.js')).default.seedStatutoryRates();
  // ---- Phase 6.5: synonyms + a full search index build ----
  await (await import('../src/services/search.service.js')).default.seedSynonyms();
  await (await import('../src/services/searchIndexer.service.js')).default.reindexAll({});

  // ---- seed (full demo tenant: catalog, slots, Phase 3.5 policies, rider) ----
  const { runSeed } = await import('./seed-default-tenant.js');
  const tenantId = await runSeed();
  const tenant = await Tenant.findById(tenantId);
  config.tenant.defaultTenantId = tenant.id;

  // ---- Phase 6 demo enrichment (idempotent, non-fatal) ----
  // Makes the admin console demo rich out of the box: default tenant gets a pro
  // subscription, marketplace mode ON, a published storefront, and ~10 demo
  // orders + analytics daily rows so dashboards show real curves.
  try {
    const { default: billingService } = await import('../src/services/billing.service.js');
    const { default: ProductMaster } = await import('../src/models/productMaster.model.js');
    const { default: Order } = await import('../src/models/order.model.js');
    const { default: OrderItem } = await import('../src/models/orderItem.model.js');
    const { default: TenantProduct } = await import('../src/models/tenantProduct.model.js');
    const { default: AnalyticsDaily } = await import('../src/models/analyticsDaily.model.js');
    const { default: User } = await import('../src/models/user.model.js');

    const sub = await billingService.currentSubscription({ tenantId });
    if (!sub) {
      await billingService.ensureSubscription({ tenantId, planCode: 'pro', trialDays: 0 });
      console.log('[demo] default tenant: pro subscription ensured (active)');
    }
    await Tenant.updateOne(
      { _id: tenantId },
      {
        $set: {
          'features.marketplaceEnabled': true,
          'store.isPublished': true,
          'store.onboardingStatus': 'active',
          'store.tagline': 'Fresh flowers, delivered same day',
          'store.description': "Kakinada's favourite flower shop — roses, marigold, bouquets and more, at your door.",
        },
      }
    );
    console.log('[demo] default tenant: marketplace mode ON + storefront published');

    const orderCount = await Order.countDocuments({ tenantId });
    if (orderCount === 0) {
      const listings = await TenantProduct.find({ tenantId }).limit(6).lean();
      const user = await User.findOne({ tenantId, role: { $in: ['super_admin', 'admin'] } }).lean();
      if (listings.length && user) {
        const masters = await ProductMaster.find({ _id: { $in: listings.map((l) => l.productMasterId) } }).lean();
        const masterById = new Map(masters.map((m) => [String(m._id), m]));
        const statuses = ['delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'cancelled', 'confirmed', 'out_for_delivery', 'delivered'];
        const daysBack = [1, 2, 3, 5, 6, 8, 9, 12, 15, 18];
        const perDay = new Map();
        for (let i = 0; i < 10; i += 1) {
          const createdAt = new Date(Date.now() - daysBack[i] * 86400000 - i * 3600000);
          const listing = listings[i % listings.length];
          const master = masterById.get(String(listing.productMasterId));
          const qty = 1 + (i % 3);
          const selling = listing.price?.sellingPrice || 299;
          const lineTotal = selling * qty;
          const deliveryFee = lineTotal >= 499 ? 0 : 49;
          const tax = Math.round(lineTotal * 0.05);
          const total = lineTotal + deliveryFee + tax;
          const status = statuses[i % statuses.length];
          const dateStr = createdAt.toISOString().slice(0, 10);
          const order = await Order.create({
            tenantId,
            userId: user._id,
            orderNumber: `FM-DEMO-${String(i + 1).padStart(3, '0')}`,
            status,
            source: 'app',
            itemsCount: 1,
            itemsSubtotal: lineTotal,
            deliveryFee,
            discount: 0,
            taxAmount: tax,
            totalAmount: total,
            currency: 'INR',
            paymentMethod: i % 2 ? 'wallet' : 'cod',
            slotSnapshot: { slotId: new mongoose.Types.ObjectId(), date: dateStr, startTime: '10:00', endTime: '13:00', displayLabel: '10 AM – 1 PM' },
            addressSnapshot: { addressId: new mongoose.Types.ObjectId(), name: 'Demo Customer', phone: '+91 9000000000', line1: '12 Ganjam Road', city: 'Kakinada', state: 'Andhra Pradesh', pincode: '533001' },
            createdAt,
          });
          await OrderItem.create({
            orderId: order._id,
            tenantId,
            tenantProductId: listing._id,
            productMasterId: listing.productMasterId,
            skuSnapshot: { skuGlobal: master?.skuGlobal || null, title: master?.title || 'Flowers' },
            priceAtOrder: { mrp: listing.price?.mrp || null, sellingPrice: selling, currency: 'INR' },
            qty,
            lineTotal,
            taxAmount: tax,
            isReturnable: true,
          });
          const d = perDay.get(dateStr) || { ordersCreated: 0, gmv: 0, delivered: 0, cancelled: 0 };
          d.ordersCreated += 1;
          if (status !== 'cancelled') d.gmv += total;
          if (status === 'delivered') d.delivered += 1;
          if (status === 'cancelled') d.cancelled += 1;
          perDay.set(dateStr, d);
        }
        for (const [date, d] of perDay) {
          await AnalyticsDaily.updateOne(
            { tenantId, hubId: null, date },
            {
              $setOnInsert: {
                ordersCreated: d.ordersCreated,
                gmv: Math.round(d.gmv * 100) / 100,
                netRevenue: Math.round(d.gmv * 100) / 100,
                aov: d.ordersCreated ? Math.round((d.gmv / d.ordersCreated) * 100) / 100 : 0,
                delivered: d.delivered,
                cancelled: d.cancelled,
                computedAt: new Date(),
                version: 1,
              },
            },
            { upsert: true }
          );
        }
        console.log('[demo] seeded 10 demo orders + analytics daily rows');
      }
    } else {
      console.log(`[demo] demo orders already present (${orderCount}) — skipping`);
    }
  } catch (err) {
    console.warn('[demo] Phase 6 demo enrichment skipped:', err.message);
  }

  // ---- app + landing page ----
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  app.get('/', (req, res) => {
    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Flower Market API — live demo</title>
<style>body{font-family:ui-monospace,Menlo,monospace;max-width:860px;margin:40px auto;padding:0 20px;background:#0f1115;color:#e6e6e6;line-height:1.6}
h1{color:#f5b942}code{background:#1c2029;padding:2px 6px;border-radius:4px;color:#8fd08f}
a{color:#7db8ff}.ok{color:#6ee76e}.warn{color:#f5b942}</style></head><body>
<h1>🌷 Flower Market API — live demo</h1>
<p><span class="ok">● running</span> with an in-memory MongoDB (data resets on restart).</p>
<h2>Try it</h2>
<ul>
<li><a href="/api/v1/health">GET /api/v1/health</a> — liveness + resolved tenant</li>
<li><a href="/api/v1/not-a-route">GET /api/v1/not-a-route</a> — structured 404</li>
</ul>
<h2>Full flow (from a terminal / Postman)</h2>
<pre>
# 1. request an OTP — the code is printed in the <b>server console below</b>
curl -s -X POST ${req.protocol}://${req.get('host')}/api/v1/auth/otp/request \\
  -H 'content-type: application/json' \\
  -d '{"purpose":"login","channel":"phone","phone":{"countryCode":"+91","number":"9876543210"}}'

# 2. verify the OTP (use the code from the console) — get accessToken + refreshToken
curl -s -X POST ${req.protocol}://${req.get('host')}/api/v1/auth/otp/verify \\
  -H 'content-type: application/json' \\
  -d '{"purpose":"login","channel":"phone","phone":{"countryCode":"+91","number":"9876543210"},"code":"&lt;CODE&gt;","device":{"deviceId":"demo","platform":"web"}}'

# 3. use the token
curl -s ${req.protocol}://${req.get('host')}/api/v1/users/me \\
  -H 'authorization: Bearer &lt;ACCESS_TOKEN&gt;'
</pre>
<p class="warn">Note: the in-app preview iframe is sandboxed — use the terminal for the curl flow; the links above work in a full browser tab.</p>
</body></html>`);
  });

  app.listen(PORT, () => {
    console.log(`[demo] Flower Market API on http://0.0.0.0:${PORT}  (tenantId=${tenant.id})`);
    console.log('[demo] OTP codes appear in this console. Ctrl+C to stop.');
  });

  process.on('SIGINT', async () => {
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[demo] failed to start:', err);
  process.exit(1);
});
