/**
 * smoke-domains.test.js — Phase 6.4 host-based tenant resolution.
 *
 * Dual mode (MONGODB_URI → real Mongo; else memory server; else SKIP unless
 * REQUIRE_DB=true). The parsing is proven without a database by
 * scripts/hostname.test.js (55 assertions incl. a hostile-host fuzz); this
 * suite proves the DB-bound half: resolution, the unknown-subdomain 404, the
 * verification gate, the cache and the TLS hook.
 */

import mongoose from 'mongoose';
import config from '../src/config/index.js';

let passed = 0;
let failed = 0;
const failures = [];
const check = (n, ok, d = '') => { if (ok) { passed += 1; console.log(`  ✅ ${n}`); } else { failed += 1; failures.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`); } };
const eq = (n, a, e) => check(n, a === e, `expected ${e}, got ${a}`);
const section = (t) => console.log(`\n${t}`);

let mongod = null;
async function connect() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    return 'real MongoDB';
  }
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('fm_domains_test'), { autoIndex: true });
  return 'mongodb-memory-server';
}

async function main() {
  let mode;
  try { mode = await connect(); } catch (err) {
    const msg = `no database available (${err.message.split('\n')[0]})`;
    if (process.env.REQUIRE_DB === 'true') { console.error(`\n❌ smoke-domains: ${msg}\n`); process.exit(1); }
    console.log('\n⏭  SKIPPED — smoke-domains needs MongoDB.');
    console.log(`   ${msg}`);
    console.log('   (host parsing is fully covered by scripts/hostname.test.js)\n');
    process.exit(0);
  }
  console.log(`\n🌐 Phase 6.4 domain routing smoke — ${mode}`);

  config.domains.rootDomain = 'flowermarket.in';
  config.domains.enabled = true;

  const { default: svc } = await import('../src/services/tenantDomain.service.js');
  const { default: Tenant } = await import('../src/models/tenant.model.js');
  const { default: TenantDomain } = await import('../src/models/tenantDomain.model.js');
  const { DOMAIN_VERIFICATION_STATUS } = await import('../src/constants/enums.js');

  await Promise.all([Tenant.deleteMany({}), TenantDomain.deleteMany({})]);
  svc.invalidate();

  const rose = await Tenant.create({ name: 'Rose Bazaar', slug: 'rosebazaar', type: 'business', status: 'active' });
  const lily = await Tenant.create({ name: 'Lily Co', slug: 'lilyco', type: 'business', status: 'active' });
  const dead = await Tenant.create({ name: 'Closed', slug: 'closedstore', type: 'business', status: 'inactive' });

  // -------------------------------------------------------------------------
  section('1. subdomain resolution');
  // -------------------------------------------------------------------------
  const r1 = await svc.resolveByHost('rosebazaar.flowermarket.in');
  eq('resolves to the right tenant', String(r1.tenantId), String(rose._id));
  eq('records how it resolved', r1.source, 'host_subdomain');
  const r2 = await svc.resolveByHost('lilyco.flowermarket.in:443');
  eq('a port does not confuse it', String(r2.tenantId), String(lily._id));

  eq('the apex is not a store', await svc.resolveByHost('flowermarket.in'), null);
  eq('a reserved subdomain is not a store', await svc.resolveByHost('api.flowermarket.in'), null);
  eq('localhost is not a store', await svc.resolveByHost('localhost:4000'), null);
  eq('the sandbox preview host is not a store', await svc.resolveByHost('5173-abc.e2b.app'), null);

  // -------------------------------------------------------------------------
  section('2. ★ unknown and inactive stores fail closed');
  // -------------------------------------------------------------------------
  let unknown = null;
  try { await svc.resolveByHost('nosuchstore.flowermarket.in'); } catch (e) { unknown = e; }
  eq('★ an unknown store subdomain 404s instead of falling back', unknown?.code, 'STORE_NOT_FOUND');

  let inactive = null;
  try { await svc.resolveByHost('closedstore.flowermarket.in'); } catch (e) { inactive = e; }
  eq('an inactive tenant does not resolve either', inactive?.code, 'STORE_NOT_FOUND');
  check('…and the deactivated tenant exists, so this is a policy decision not a missing row', Boolean(dead));

  // -------------------------------------------------------------------------
  section('3. custom domains only resolve once VERIFIED');
  // -------------------------------------------------------------------------
  const added = await svc.add({ tenantId: rose._id, hostname: 'Shop.RoseBazaar.com' });
  eq('hostname is normalised on the way in', added.domain.hostname, 'shop.rosebazaar.com');
  check('a DNS record is issued to prove ownership', /^_fm-verify\./.test(added.dnsRecord.name));
  check('the token is unguessable', added.dnsRecord.value.length > 20);

  eq('★ an unverified custom domain resolves to nothing',
    await svc.resolveByHost('shop.rosebazaar.com'), null);
  eq('★ …and is refused a TLS certificate',
    await svc.isAllowedForTls('shop.rosebazaar.com'), false);

  // simulate a successful DNS check
  await TenantDomain.updateOne(
    { _id: added.domain._id },
    { $set: { 'verification.status': DOMAIN_VERIFICATION_STATUS.VERIFIED, 'verification.verifiedAt': new Date() } }
  );
  svc.invalidate('shop.rosebazaar.com');

  const custom = await svc.resolveByHost('shop.rosebazaar.com');
  eq('once verified it resolves', String(custom.tenantId), String(rose._id));
  eq('and is flagged as a custom host', custom.source, 'host_custom');
  eq('and is now allowed a certificate', await svc.isAllowedForTls('shop.rosebazaar.com'), true);

  // -------------------------------------------------------------------------
  section('4. a hostname belongs to exactly one tenant');
  // -------------------------------------------------------------------------
  let taken = null;
  try { await svc.add({ tenantId: lily._id, hostname: 'shop.rosebazaar.com' }); } catch (e) { taken = e; }
  eq('★ another tenant cannot claim a taken domain', taken?.code, 'HOSTNAME_TAKEN');

  let managed = null;
  try { await svc.add({ tenantId: lily._id, hostname: 'lilyco.flowermarket.in' }); } catch (e) { managed = e; }
  eq('platform subdomains cannot be hand-claimed', managed?.code, 'HOSTNAME_MANAGED');

  let reserved = null;
  try { await svc.add({ tenantId: lily._id, hostname: 'api.flowermarket.in' }); } catch (e) { reserved = e; }
  eq('reserved subdomains are refused', reserved?.code, 'HOSTNAME_RESERVED');

  let apex = null;
  try { await svc.add({ tenantId: lily._id, hostname: 'flowermarket.in' }); } catch (e) { apex = e; }
  eq('the apex is refused', apex?.code, 'HOSTNAME_RESERVED');

  let bad = null;
  try { await svc.add({ tenantId: lily._id, hostname: 'not a host' }); } catch (e) { bad = e; }
  eq('a malformed hostname is refused', bad?.code, 'BAD_HOSTNAME');

  // -------------------------------------------------------------------------
  section('5. the cache');
  // -------------------------------------------------------------------------
  svc.invalidate();
  const before = svc.cacheStats;
  await svc.resolveByHost('rosebazaar.flowermarket.in');
  await svc.resolveByHost('rosebazaar.flowermarket.in');
  await svc.resolveByHost('rosebazaar.flowermarket.in');
  const after = svc.cacheStats;
  check('repeated lookups hit the cache', after.hits > before.hits, JSON.stringify(after));

  // a negative result must be cached too, or an unknown host hammers the DB
  try { await svc.resolveByHost('ghost.flowermarket.in'); } catch { /* expected */ }
  const hitsBefore = svc.cacheStats.hits;
  try { await svc.resolveByHost('ghost.flowermarket.in'); } catch { /* expected */ }
  check('★ negative results are cached (an unknown host cannot hammer the DB)',
    svc.cacheStats.hits > hitsBefore);

  // and invalidation actually works
  await Tenant.updateOne({ _id: lily._id }, { $set: { slug: 'lily-flowers' } });
  svc.invalidateTenant('lilyco');
  let goneOld = null;
  try { await svc.resolveByHost('lilyco.flowermarket.in'); } catch (e) { goneOld = e; }
  eq('the old hostname stops resolving after invalidation', goneOld?.code, 'STORE_NOT_FOUND');
  const renamed = await svc.resolveByHost('lily-flowers.flowermarket.in');
  eq('the new hostname resolves', String(renamed.tenantId), String(lily._id));

  // -------------------------------------------------------------------------
  section('6. primary domain & canonical host');
  // -------------------------------------------------------------------------
  const canonicalBefore = await svc.canonicalHostFor({ tenantId: rose._id, slug: 'rosebazaar' });
  eq('defaults to the platform subdomain', canonicalBefore, 'rosebazaar.flowermarket.in');

  await svc.setPrimary({ tenantId: rose._id, domainId: added.domain._id });
  const canonicalAfter = await svc.canonicalHostFor({ tenantId: rose._id, slug: 'rosebazaar' });
  eq('a verified primary domain becomes canonical', canonicalAfter, 'shop.rosebazaar.com');

  const unverified = await svc.add({ tenantId: lily._id, hostname: 'shop.lilyco.com' });
  let notVerified = null;
  try { await svc.setPrimary({ tenantId: lily._id, domainId: unverified.domain._id }); } catch (e) { notVerified = e; }
  eq('an unverified domain cannot be primary', notVerified?.code, 'DOMAIN_NOT_VERIFIED');

  // -------------------------------------------------------------------------
  section('7. removal');
  // -------------------------------------------------------------------------
  await svc.remove({ tenantId: lily._id, domainId: unverified.domain._id });
  eq('removed domains stop resolving', await svc.resolveByHost('shop.lilyco.com'), null);
  const live = await svc.liveHostnames();
  check('the CORS host set lists only verified domains', live.includes('shop.rosebazaar.com') && !live.includes('shop.lilyco.com'), live.join(','));

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`domain routing: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); for (const f of failures) console.log(`  • ${f}`); }
}

async function cleanup() {
  await mongoose.disconnect().catch(() => {});
  if (mongod) await mongod.stop().catch(() => {});
}

main()
  .then(async () => { await cleanup(); process.exit(failed ? 1 : 0); })
  .catch(async (e) => { console.error('\n❌ suite crashed:', e); await cleanup(); process.exit(1); });
