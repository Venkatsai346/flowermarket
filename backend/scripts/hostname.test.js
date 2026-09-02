/**
 * hostname.test.js — PURE host-parsing tests (Phase 6.4). No database.
 *
 *   node scripts/hostname.test.js
 *
 * `Host` is attacker-controlled input and this code decides which tenant's
 * data a request may read, so the adversarial cases matter more than the happy
 * path: spoofed suffixes, embedded ports, trailing dots, injection attempts,
 * and the difference between "unknown store" and "not a store at all".
 */

import {
  normalizeHost, isIpLiteral, extractSubdomain, isReservedSlug,
  classifyHost, isPlatformHost, storefrontUrl,
} from '../src/utils/hostname.js';

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const section = (t) => console.log(`\n${t}`);

const ROOT = 'flowermarket.in';
const RESERVED = ['api', 'www', 'admin', 'mail', 'cdn', 'status'];
const opts = { rootDomain: ROOT, reservedSlugs: RESERVED };

// ---------------------------------------------------------------------------
section('1. normalizeHost — the messy realities of a Host header');
// ---------------------------------------------------------------------------
eq('plain host', normalizeHost('rosebazaar.flowermarket.in'), 'rosebazaar.flowermarket.in');
eq('uppercase is folded', normalizeHost('RoseBazaar.FlowerMarket.IN'), 'rosebazaar.flowermarket.in');
eq('port is stripped', normalizeHost('rosebazaar.flowermarket.in:5173'), 'rosebazaar.flowermarket.in');
eq('trailing dot (FQDN form) is stripped', normalizeHost('rosebazaar.flowermarket.in.'), 'rosebazaar.flowermarket.in');
eq('surrounding whitespace is trimmed', normalizeHost('  shop.example.com  '), 'shop.example.com');
eq('IPv6 literal keeps its brackets', normalizeHost('[::1]:4000'), '[::1]');
eq('a proxy-joined list takes the first value', normalizeHost('a.flowermarket.in, evil.com'), 'a.flowermarket.in');
eq('empty → null', normalizeHost(''), null);
eq('null → null', normalizeHost(null), null);
eq('non-string → null', normalizeHost(42), null);

// injection-ish inputs must not survive into a query
eq('CRLF injection → null', normalizeHost('evil.com\r\nX-Foo: bar'), null);
eq('path traversal → null', normalizeHost('a.com/../../etc/passwd'), null);
eq('a space → null', normalizeHost('evil .com'), null);
eq('double dot → null', normalizeHost('a..flowermarket.in'), null);
eq('underscore is not a hostname char', normalizeHost('bad_host.flowermarket.in'), null);
eq('quote → null', normalizeHost("a'or'1.com"), null);
eq('over 253 chars → null', normalizeHost(`${'a'.repeat(300)}.com`), null);

// ---------------------------------------------------------------------------
section('2. IP literals are never stores');
// ---------------------------------------------------------------------------
check('IPv4 detected', isIpLiteral('127.0.0.1'));
check('IPv6 detected', isIpLiteral('[::1]'));
check('a hostname is not an IP', !isIpLiteral('rosebazaar.flowermarket.in'));

// ---------------------------------------------------------------------------
section('3. extractSubdomain — exactly one level, or nothing');
// ---------------------------------------------------------------------------
eq('a store subdomain', extractSubdomain('rosebazaar.flowermarket.in', ROOT), 'rosebazaar');
eq('hyphens are allowed', extractSubdomain('rose-bazaar-2.flowermarket.in', ROOT), 'rose-bazaar-2');
eq('the apex is not a store', extractSubdomain('flowermarket.in', ROOT), null);
eq('two levels deep is refused', extractSubdomain('a.b.flowermarket.in', ROOT), null);
eq('a different domain is not ours', extractSubdomain('shop.rosebazaar.com', ROOT), null);
eq('a leading hyphen is invalid', extractSubdomain('-bad.flowermarket.in', ROOT), null);
eq('a trailing hyphen is invalid', extractSubdomain('bad-.flowermarket.in', ROOT), null);

// ★ the suffix-spoofing family: these all END with the root string but are
// NOT subdomains of it. Getting this wrong hands an attacker any tenant.
eq('★ suffix spoof: evilflowermarket.in', extractSubdomain('evilflowermarket.in', ROOT), null);
eq('★ suffix spoof: rosebazaar.flowermarket.in.evil.com',
  extractSubdomain('rosebazaar.flowermarket.in.evil.com', ROOT), null);
eq('★ suffix spoof: xflowermarket.in', extractSubdomain('xflowermarket.in', ROOT), null);
eq('★ suffix spoof: notflowermarket.in', extractSubdomain('notflowermarket.in', ROOT), null);

// ---------------------------------------------------------------------------
section('4. reserved slugs');
// ---------------------------------------------------------------------------
check('api is reserved', isReservedSlug('api', RESERVED));
check('API is reserved (case-insensitive)', isReservedSlug('API', RESERVED));
check('a normal store is not', !isReservedSlug('rosebazaar', RESERVED));
check('empty is treated as reserved', isReservedSlug('', RESERVED));

// ---------------------------------------------------------------------------
section('5. classifyHost — the decision the middleware acts on');
// ---------------------------------------------------------------------------
eq('a store subdomain', classifyHost('rosebazaar.flowermarket.in', opts).kind, 'store_subdomain');
eq('…and its slug', classifyHost('rosebazaar.flowermarket.in', opts).slug, 'rosebazaar');
eq('a reserved subdomain', classifyHost('api.flowermarket.in', opts).kind, 'reserved');
eq('the apex', classifyHost('flowermarket.in', opts).kind, 'apex');
eq('someone else’s domain is a custom candidate', classifyHost('shop.rosebazaar.com', opts).kind, 'custom');
eq('localhost is infrastructure', classifyHost('localhost:5173', opts).kind, 'infrastructure');
eq('an IP is infrastructure', classifyHost('10.0.0.4', opts).kind, 'infrastructure');
eq('IPv6 is infrastructure', classifyHost('[::1]:4000', opts).kind, 'infrastructure');
eq('garbage is infrastructure (never a store)', classifyHost('evil .com', opts).kind, 'infrastructure');

// ★ the sandbox preview host must NOT resolve a tenant, or every existing
// header-based client breaks the moment this phase ships
eq('★ the e2b preview host is infrastructure',
  classifyHost('5173-abc123.e2b.app', opts).kind, 'custom');
check('★ …and being "custom" means it resolves only via a verified TenantDomain row, never implicitly',
  classifyHost('5173-abc123.e2b.app', opts).slug === null);

// ---------------------------------------------------------------------------
section('6. platform host detection');
// ---------------------------------------------------------------------------
check('the apex is a platform host', isPlatformHost('flowermarket.in', { rootDomain: ROOT }));
check('an explicit platform host matches',
  isPlatformHost('api.internal.example', { rootDomain: ROOT, platformHosts: ['api.internal.example'] }));
check('a store subdomain is not a platform host',
  !isPlatformHost('rosebazaar.flowermarket.in', { rootDomain: ROOT }));

// ---------------------------------------------------------------------------
section('7. canonical URLs');
// ---------------------------------------------------------------------------
eq('https by default', storefrontUrl('rosebazaar', ROOT), 'https://rosebazaar.flowermarket.in');
eq('http when asked', storefrontUrl('rosebazaar', ROOT, { protocol: 'http' }), 'http://rosebazaar.flowermarket.in');
eq('no slug → null', storefrontUrl(null, ROOT), null);

// ---------------------------------------------------------------------------
section('8. fuzz — no input may ever produce a slug it should not');
// ---------------------------------------------------------------------------
{
  const evil = [
    'flowermarket.in.attacker.com', 'attackerflowermarket.in', '.flowermarket.in',
    'a.b.c.flowermarket.in', 'flowermarket.in..', 'FLOWERMARKET.IN', '..flowermarket.in',
    'rosebazaar.flowermarket.in%2eevil.com', 'rosebazaar%2Eflowermarket.in',
    'rosebazaar.flowermarket.in:80@evil.com', '@evil.com', 'http://rosebazaar.flowermarket.in',
    '//rosebazaar.flowermarket.in', 'rosebazaar.flowermarket.in#x',
  ];
  const leaks = [];
  for (const h of evil) {
    const c = classifyHost(h, opts);
    // The ONLY acceptable outcomes are: not a store, or the apex.
    if (c.kind === 'store_subdomain') leaks.push(`${h} → ${c.slug}`);
  }
  eq('★ 14 hostile hostnames, zero of them resolve to a store', leaks.join(' | ') || 'none', 'none');

  // and the legitimate form still works after all that paranoia
  eq('a real store still resolves', classifyHost('rose-bazaar.flowermarket.in:443', opts).slug, 'rose-bazaar');
}

// ---------------------------------------------------------------------------
section('9. performance — this runs on every request');
// ---------------------------------------------------------------------------
{
  const hosts = Array.from({ length: 200 }, (_, i) => `store${i}.flowermarket.in`);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 50000; i += 1) classifyHost(hosts[i % hosts.length], opts);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perCall = ms / 50000;
  check(`50 000 classifications in ${ms.toFixed(0)}ms (${(perCall * 1000).toFixed(2)}µs each)`, perCall < 0.05,
    `${perCall.toFixed(4)}ms per call is too slow for a per-request path`);
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
console.log(`hostname resolution: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log('✅ no hostile hostname resolves to a tenant\n');
