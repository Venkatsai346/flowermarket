#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const model = read('src/models/searchInteraction.model.js');
const analytics = read('src/services/searchAnalytics.service.js');
const routes = read('src/routes/search.routes.js');
const indexer = read('src/services/searchIndexer.service.js');
const card = read('../frontend/apps/storefront/src/components/ProductCard.jsx');
const feed = read('../frontend/apps/storefront/src/lib/useCatalogFeed.js');
const cart = read('src/services/cart.service.js');
const order = read('src/services/order.service.js');
const merchandising = read('src/services/searchMerchandising.service.js');

const checks = [
  ['tenant-scoped event idempotency', /tenantId: 1, eventId: 1[^\n]+unique: true/.test(model)],
  ['bounded event retention', /expireAfterSeconds: 180 \* 24 \* 3600/.test(model)],
  ['cross-session attribution rejected', /query\.sessionHash !== hash/.test(analytics)],
  ['candidate poisoning rejected', /listing_not_in_results/.test(analytics)],
  ['public purchase events rejected', !/valid\([^)]*PURCHASE/.test(routes)],
  ['true 30-day boundary', /Date\.now\(\) - 30 \* 86400000/.test(analytics)],
  ['lifetime soldCount no longer indexed', !/soldCount30d:\s*master\.soldCount/.test(indexer)],
  ['impressions use visibility threshold', /IntersectionObserver/.test(card) && /intersectionRatio >= 0\.5/.test(card)],
  ['page attribution retained per item', /_search: \{ \.\.\.attribution, position: pageOffset \+ index \}/.test(feed)],
  ['cart attribution is server verified', /validateAttribution/.test(cart)],
  ['trusted order line preserves attribution', /searchQueryId: i\.searchQueryId/.test(order)],
  ['learning adapter no longer mutates sampled query logs', !/SearchQueryLog\.(?:update|aggregate|create)/.test(read('src/services/learningToRank.service.js'))],
  ['scheduled active window enforced', /startsAt: \{ \$lte: now \}/.test(merchandising) && /endsAt: \{ \$gt: now \}/.test(merchandising)],
  ['redirects remain application relative', /startsWith\('\/'\)/.test(read('src/models/searchMerchandisingRule.model.js'))],
];
for (const [name, passed] of checks) {
  assert.ok(passed, name);
  console.log(`✓ ${name}`);
}
console.log(`\nSearch analytics and merchandising: ${checks.length} safeguards passed.`);
