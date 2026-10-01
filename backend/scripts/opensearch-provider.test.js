import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OpenSearchProvider, OpenSearchTransport } from '../src/services/opensearchProvider.service.js';

class FakeTransport {
  constructor() { this.calls = []; this.aliasesReady = false; this.rebuilding = false; }
  async request(path, options = {}) {
    this.calls.push({ path, options });
    if (path.includes('_alias/test-catalog-read')) {
      if (!this.aliasesReady) return { status: 404, data: null };
      return { status: 200, data: { 'test-catalog-old': {} } };
    }
    if (path.includes('_alias/test-catalog-rebuild')) {
      return this.rebuilding
        ? { status: 200, data: { 'test-catalog-rebuild-target': {} } }
        : { status: 404, data: null };
    }
    if (path === '/_aliases') {
      this.aliasesReady = true;
      if (options.body?.actions?.some((action) => action.add?.alias === 'test-catalog-rebuild')) this.rebuilding = true;
      if (options.body?.actions?.some((action) => action.remove?.alias === 'test-catalog-rebuild')) this.rebuilding = false;
      return { status: 200, data: { acknowledged: true } };
    }
    if (path === '/_bulk') {
      const lines = options.body.trim().split('\n');
      return { status: 200, data: { items: Array.from({ length: lines.length / 2 }, () => ({ index: { status: 200 } })) } };
    }
    if (path.endsWith('/_search')) {
      if (options.body.size === 0) return { status: 200, data: { aggregations: {
        categories: { buckets: [{ key: 'cat-1', doc_count: 2 }] }, brands: { buckets: [] },
        availability: { buckets: [{ key: 1, key_as_string: 'true', doc_count: 2 }] },
        price: { min: 10000, max: 25000 },
      } } };
      return { status: 200, data: { hits: { hits: [{ _id: 'tenant:list', _score: 4.2, _source: {
        key: 'tenant:list', tenantId: 'tenant', listingId: 'list', masterId: 'master', title: 'Red Rose', status: 'active',
      } }] } } };
    }
    if (path.includes('_cluster/health')) return { status: 200, data: { status: 'green', timed_out: false } };
    if (path.endsWith('/_count')) return { status: 200, data: { count: 1 } };
    return { status: 200, data: { acknowledged: true } };
  }
}

const canonical = {
  indexed: 0, removed: 0,
  async index(docs) { this.indexed += docs.length; return { indexed: docs.length }; },
  async remove(keys) { this.removed += keys.length; return { removed: keys.length }; },
  async vocabulary() { return ['rose', 'bouquet']; },
};
const transport = new FakeTransport();
const provider = new OpenSearchProvider({ canonical, transport, options: { indexPrefix: 'test-catalog' } });

const document = {
  key: 'tenant:list', tenantId: 'tenant', listingId: 'list', masterId: 'master', title: 'Red Rose', status: 'active',
  attributes: { colour: 'red', stemLength: 40 }, pricePaise: 10000, inStock: true,
};
const indexed = await provider.index([document]);
assert.equal(indexed.indexed, 1);
assert.equal(canonical.indexed, 1, 'Mongo projection remains the durable canonical fallback');
const bulk = transport.calls.find((call) => call.path === '/_bulk');
assert.match(bulk.options.body, /"attributeTerms":\["colour=red","stemLength=40"\]/);
assert.match(bulk.options.body, /"attributeNumbers":\[\{"key":"stemLength","value":40\}\]/);

const rows = await provider.retrieve({
  tenantId: 'tenant', parsed: { expanded: ['red', 'rose'] },
  filters: { categoryId: 'cat-1', minPrice: 50, attributes: { stemLength: { min: 30 } } }, limit: 20,
});
assert.equal(rows[0]._id, 'tenant:list');
assert.equal(rows[0]._providerScore, 4.2);
const searchCall = transport.calls.filter((call) => call.path.endsWith('/_search')).at(-1);
assert.equal(searchCall.options.body.query.bool.must[0].multi_match.fuzziness, 'AUTO');
assert.ok(searchCall.options.body.query.bool.filter.some((filter) => filter.nested), 'numeric attributes use a type-safe nested range');

const facets = await provider.facets({ tenantId: 'tenant', parsed: { tokens: [] }, filters: {} });
assert.deepEqual(facets.priceRange, { min: 100, max: 250 });
assert.equal(facets.inStock, 2);

const rebuild = await provider.beginReindex();
assert.match(rebuild.target, /^test-catalog-/);
await provider.completeReindex(rebuild.target);
const switchCall = transport.calls.filter((call) => call.path === '/_aliases').at(-1);
assert.ok(switchCall.options.body.actions.some((action) => action.add?.alias === 'test-catalog-read'));
assert.ok(switchCall.options.body.actions.some((action) => action.add?.is_write_index === true));

const health = await provider.health();
assert.equal(health.ok, true);
assert.equal(health.documents, 1);

let attempts = 0;
const http = new OpenSearchTransport({
  endpoint: 'http://search.test', apiKey: 'abc', maxRetries: 1, timeoutMs: 100,
  fetchImpl: async (_url, options) => {
    attempts += 1;
    assert.equal(options.headers.authorization, 'ApiKey abc');
    if (attempts === 1) return new Response(JSON.stringify({ error: { type: 'busy' } }), { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  },
});
const retried = await http.request('/_cluster/health');
assert.equal(retried.data.ok, true);
assert.equal(attempts, 2, 'retryable 503 is retried once');

const controllerSource = fs.readFileSync(new URL('../src/controllers/search.controller.js', import.meta.url), 'utf8');
assert.match(controllerSource, /allTenants\s*&&\s*req\.auth\.role\s*!==\s*USER_ROLES\.SUPER_ADMIN/);
const routeSource = fs.readFileSync(new URL('../src/routes/search.routes.js', import.meta.url), 'utf8');
assert.match(routeSource, /post\('\/reindex',\s*storeAdmin,\s*validate\(reindexSchema\)/);

console.log('OpenSearch provider: mapping, fuzzy retrieval, facets, retries, alias switching and global-rebuild authorization passed');
