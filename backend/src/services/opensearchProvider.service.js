import crypto from 'node:crypto';
import config from '../config/index.js';
import { searchProviderRequests, searchProviderDuration } from '../observability/registry.js';

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_BULK_DOCS = 500;

export class OpenSearchError extends Error {
  constructor(message, { status = 502, code = 'OPENSEARCH_ERROR', retryable = false, details = null } = {}) {
    super(message);
    this.name = 'OpenSearchError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

function plain(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    if (value._bsontype === 'ObjectId' || value.constructor?.name === 'ObjectId') return String(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

function externalDocument(raw) {
  const doc = plain(raw);
  const attributeTerms = [];
  const attributeNumbers = [];
  for (const [key, value] of Object.entries(doc.attributes || {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item == null || typeof item === 'object') continue;
      attributeTerms.push(`${key}=${String(item)}`);
      if (Number.isFinite(Number(item)) && String(item).trim() !== '') attributeNumbers.push({ key, value: Number(item) });
    }
  }
  return { ...doc, attributeTerms, attributeNumbers };
}

function safeName(value, fallback) {
  const name = String(value || fallback).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,120}$/.test(name)) {
    throw new OpenSearchError('Invalid OpenSearch index prefix.', { status: 500, code: 'OPENSEARCH_CONFIG_INVALID' });
  }
  return name;
}

function escapeQuery(value) {
  // `match`/`multi_match` consume analyzed text, not query-string syntax.
  return String(value || '').trim();
}

function operationFor(path) {
  if (path.includes('_bulk')) return 'bulk';
  if (path.includes('_search')) return 'search';
  if (path.includes('_aliases') || path.includes('_alias/')) return 'aliases';
  if (path.includes('_cluster/health')) return 'health';
  if (path.includes('_count')) return 'count';
  if (path.includes('_refresh')) return 'refresh';
  return 'index_admin';
}

/** Minimal HTTP transport with bounded retries and redacted diagnostics. */
export class OpenSearchTransport {
  constructor(options = {}) {
    const raw = options.endpoint || config.search.opensearch.endpoint;
    if (!raw) throw new OpenSearchError('OPENSEARCH_ENDPOINT is required.', { status: 500, code: 'OPENSEARCH_CONFIG_MISSING' });
    this.endpoint = new URL(raw);
    if (this.endpoint.username || this.endpoint.password) {
      throw new OpenSearchError('OpenSearch credentials must not be embedded in the endpoint URL.', { status: 500, code: 'OPENSEARCH_CONFIG_INVALID' });
    }
    if (process.env.NODE_ENV === 'production' && this.endpoint.protocol !== 'https:') {
      throw new OpenSearchError('OpenSearch must use HTTPS in production.', { status: 500, code: 'OPENSEARCH_HTTPS_REQUIRED' });
    }
    if (!['http:', 'https:'].includes(this.endpoint.protocol)) {
      throw new OpenSearchError('OpenSearch endpoint must use HTTP or HTTPS.', { status: 500, code: 'OPENSEARCH_CONFIG_INVALID' });
    }
    this.username = options.username ?? config.search.opensearch.username;
    this.password = options.password ?? config.search.opensearch.password;
    this.apiKey = options.apiKey ?? config.search.opensearch.apiKey;
    this.timeoutMs = Math.min(30000, Math.max(100, Number(options.timeoutMs ?? config.search.opensearch.requestTimeoutMs) || 5000));
    this.maxRetries = Math.min(5, Math.max(0, Number(options.maxRetries ?? config.search.opensearch.maxRetries) || 0));
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  authorization() {
    if (this.apiKey) return `ApiKey ${this.apiKey}`;
    if (this.username) return `Basic ${Buffer.from(`${this.username}:${this.password || ''}`).toString('base64')}`;
    return null;
  }

  async request(path, { method = 'GET', body = null, ndjson = false, allow404 = false, retry = true } = {}) {
    const url = new URL(path.replace(/^\//, ''), this.endpoint.href.endsWith('/') ? this.endpoint : `${this.endpoint.href}/`);
    const headers = { accept: 'application/json' };
    const authorization = this.authorization();
    if (authorization) headers.authorization = authorization;
    let payload = body;
    if (body != null && !ndjson && typeof body !== 'string') payload = JSON.stringify(body);
    if (body != null) headers['content-type'] = ndjson ? 'application/x-ndjson' : 'application/json';

    let lastError;
    const started = process.hrtime.bigint();
    const operation = operationFor(path);
    let observed = false;
    const observe = (outcome) => {
      if (observed) return;
      observed = true;
      searchProviderRequests.inc({ provider: 'opensearch', operation, outcome });
      searchProviderDuration.observe({ provider: 'opensearch', operation }, Number(process.hrtime.bigint() - started) / 1e9);
    };
    const attempts = retry ? this.maxRetries + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        // Retries are deliberately sequential because each attempt depends on the previous outcome.
        // eslint-disable-next-line no-await-in-loop
        const response = await this.fetchImpl(url, { method, headers, body: payload, signal: controller.signal, redirect: 'error' });
        // The response must be consumed before this sequential retry attempt can be classified.
        // eslint-disable-next-line no-await-in-loop
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
        if (response.ok || (allow404 && response.status === 404)) {
          observe(response.status === 404 ? 'not_found' : 'success');
          return { status: response.status, data, headers: response.headers };
        }
        const retryable = RETRYABLE_STATUS.has(response.status);
        lastError = new OpenSearchError(`OpenSearch request failed (${response.status}).`, {
          status: response.status,
          code: retryable ? 'OPENSEARCH_TEMPORARY_FAILURE' : 'OPENSEARCH_REQUEST_FAILED',
          retryable,
          details: data?.error?.type ? { type: data.error.type, reason: String(data.error.reason || '').slice(0, 300) } : null,
        });
        if (!retryable || attempt + 1 >= attempts) throw lastError;
      } catch (error) {
        if (error instanceof OpenSearchError && !error.retryable) {
          observe('failed');
          throw error;
        }
        lastError = error instanceof OpenSearchError ? error : new OpenSearchError(
          error?.name === 'AbortError' ? 'OpenSearch request timed out.' : 'OpenSearch is unavailable.',
          { code: error?.name === 'AbortError' ? 'OPENSEARCH_TIMEOUT' : 'OPENSEARCH_UNAVAILABLE', retryable: true },
        );
        if (attempt + 1 >= attempts) {
          observe(lastError.code === 'OPENSEARCH_TIMEOUT' ? 'timeout' : 'failed');
          throw lastError;
        }
      } finally {
        clearTimeout(timer);
      }
      // Backoff must be sequential because it gates the next bounded retry attempt.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 50 * (2 ** attempt)) + crypto.randomInt(0, 50)));
    }
    throw lastError;
  }
}

function indexDefinition({ shards, replicas }) {
  return {
    settings: {
      number_of_shards: Math.min(24, Math.max(1, Number(shards) || 1)),
      number_of_replicas: Math.min(5, Math.max(0, Number(replicas) || 0)),
      refresh_interval: '1s',
      analysis: {
        filter: { catalog_edge: { type: 'edge_ngram', min_gram: 2, max_gram: 20 } },
        analyzer: {
          catalog_index: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding', 'catalog_edge'] },
          catalog_search: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
        },
      },
    },
    mappings: {
      dynamic: 'strict',
      properties: {
        key: { type: 'keyword' }, tenantId: { type: 'keyword' }, listingId: { type: 'keyword' }, masterId: { type: 'keyword' },
        vendorId: { type: 'keyword' }, variantId: { type: 'keyword' }, variantLabel: { type: 'text', analyzer: 'catalog_index', search_analyzer: 'catalog_search' },
        variantType: { type: 'keyword' }, optionValues: { type: 'object', enabled: false },
        title: { type: 'text', analyzer: 'catalog_index', search_analyzer: 'catalog_search', fields: { exact: { type: 'keyword', ignore_above: 256 } } },
        slug: { type: 'keyword' }, searchText: { type: 'text', analyzer: 'catalog_index', search_analyzer: 'catalog_search' },
        brandName: { type: 'text', analyzer: 'catalog_index', search_analyzer: 'catalog_search', fields: { exact: { type: 'keyword', ignore_above: 128 } } },
        brandId: { type: 'keyword' }, productType: { type: 'keyword' }, productKind: { type: 'keyword' },
        unitPolicy: { type: 'object', enabled: false }, packageCodes: { type: 'keyword' }, complianceCodes: { type: 'keyword' },
        variantAttributes: { type: 'object', enabled: false }, categoryId: { type: 'keyword' }, categoryPath: { type: 'keyword' },
        tags: { type: 'text', analyzer: 'catalog_index', search_analyzer: 'catalog_search' }, suggest: { type: 'text', analyzer: 'catalog_index', search_analyzer: 'catalog_search' },
        attributes: { type: 'object', enabled: false }, attributeTerms: { type: 'keyword' },
        attributeNumbers: { type: 'nested', properties: { key: { type: 'keyword' }, value: { type: 'double' } } },
        pricePaise: { type: 'long' }, mrpPaise: { type: 'long' }, stockQty: { type: 'double' },
        inStock: { type: 'boolean' }, unit: { type: 'keyword' }, imageUrl: { type: 'keyword', index: false }, soldCount30d: { type: 'long' },
        clicks30d: { type: 'long' }, impressions30d: { type: 'long' }, returnRate30d: { type: 'float' }, vendorRating: { type: 'float' },
        marginScore: { type: 'float' }, isPerishable: { type: 'boolean' }, isPromoted: { type: 'boolean' }, promotedUntil: { type: 'date' },
        listedAt: { type: 'date' }, status: { type: 'keyword' }, indexedAt: { type: 'date' }, sourceVersion: { type: 'long' },
      },
    },
  };
}

function filterClauses(tenantId, filters = {}) {
  const clauses = [{ term: { tenantId: String(tenantId) } }, { term: { status: 'active' } }];
  if (filters.categoryIds?.length) clauses.push({ terms: { categoryId: filters.categoryIds.map(String) } });
  else if (filters.categoryId) clauses.push({ term: { categoryId: String(filters.categoryId) } });
  if (filters.brandId) clauses.push({ term: { brandId: String(filters.brandId) } });
  if (filters.productType) clauses.push({ term: { productType: filters.productType } });
  if (filters.vendorId) clauses.push({ term: { vendorId: String(filters.vendorId) } });
  if (filters.inStock) clauses.push({ term: { inStock: true } });
  if (filters.minPrice != null || filters.maxPrice != null) clauses.push({ range: { pricePaise: {
    ...(filters.minPrice != null ? { gte: Math.round(filters.minPrice * 100) } : {}),
    ...(filters.maxPrice != null ? { lte: Math.round(filters.maxPrice * 100) } : {}),
  } } });
  if (filters.colour) clauses.push({ term: { attributeTerms: `colour=${filters.colour}` } });
  for (const [key, value] of Object.entries(filters.attributes || {})) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) clauses.push({ nested: {
      path: 'attributeNumbers',
      query: { bool: { filter: [
        { term: { 'attributeNumbers.key': key } },
        { range: { 'attributeNumbers.value': {
          ...(value.min != null ? { gte: Number(value.min) } : {}), ...(value.max != null ? { lte: Number(value.max) } : {}),
        } } },
      ] } },
    } });
    else clauses.push({ terms: { attributeTerms: (Array.isArray(value) ? value : [value]).map((item) => `${key}=${String(item)}`) } });
  }
  return clauses;
}

function searchQuery(parsed, filters) {
  const terms = parsed?.expanded?.length ? parsed.expanded : parsed?.tokens || [];
  return {
    bool: {
      filter: filterClauses(filters.tenantId, filters),
      ...(terms.length ? { must: [{ multi_match: {
        query: terms.map(escapeQuery).join(' '), fields: ['title^10', 'brandName^4', 'tags^3', 'variantLabel^2', 'searchText'],
        type: 'best_fields', operator: 'or', fuzziness: 'AUTO', prefix_length: 1, max_expansions: 30,
      } }] } : { must: [{ match_all: {} }] }),
    },
  };
}

export class OpenSearchProvider {
  constructor({ canonical, transport = null, options = {} } = {}) {
    if (!canonical) throw new Error('OpenSearchProvider requires the canonical Mongo provider');
    this.canonical = canonical;
    this.transport = transport || new OpenSearchTransport(options);
    this.prefix = safeName(options.indexPrefix || config.search.opensearch.indexPrefix, 'flowermarket-catalog');
    this.readAlias = `${this.prefix}-read`;
    this.writeAlias = `${this.prefix}-write`;
    this.rebuildAlias = `${this.prefix}-rebuild`;
    this.rebuildLock = `${this.prefix}-reindex-lock`;
    this.ready = null;
    this.rebuildTargetCache = { value: null, until: 0 };
  }

  get name() { return 'opensearch'; }

  versionedName() { return `${this.prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`; }

  async createIndex(name) {
    await this.transport.request(`/${name}`, { method: 'PUT', body: indexDefinition(config.search.opensearch), retry: false });
  }

  async ensureReady() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const existing = await this.transport.request(`/_alias/${this.readAlias}`, { allow404: true });
      if (existing.status !== 404) return;
      // Deterministic bootstrap name makes concurrent first requests converge
      // on one index instead of creating two read aliases. Index creation is
      // atomic; `already exists` means another process won safely.
      const name = `${this.prefix}-000001`;
      try {
        await this.createIndex(name);
      } catch (error) {
        if (error.details?.type !== 'resource_already_exists_exception') throw error;
      }
      await this.transport.request('/_aliases', { method: 'POST', body: { actions: [
        { add: { index: name, alias: this.readAlias } },
        { add: { index: name, alias: this.writeAlias, is_write_index: true } },
      ] } });
    })().catch((error) => { this.ready = null; throw error; });
    return this.ready;
  }

  async rebuildTarget() {
    if (this.rebuildTargetCache.value && this.rebuildTargetCache.until > Date.now()) return this.rebuildTargetCache.value;
    const response = await this.transport.request(`/_alias/${this.rebuildAlias}`, { allow404: true });
    const value = response.status === 404 ? null : Object.keys(response.data || {})[0] || null;
    this.rebuildTargetCache = { value, until: Date.now() + 2000 };
    return value;
  }

  async bulk(docs, target) {
    if (!docs.length) return 0;
    let payload = '';
    for (const raw of docs) {
      const doc = externalDocument(raw);
      payload += `${JSON.stringify({ index: {
        _index: target, _id: doc.key,
        version: Math.max(1, Number(doc.sourceVersion) || 1), version_type: 'external_gte',
      } })}\n${JSON.stringify(doc)}\n`;
    }
    const response = await this.transport.request('/_bulk', { method: 'POST', body: payload, ndjson: true });
    const failures = (response.data?.items || []).filter((item) => (
      item.index?.error && item.index.error.type !== 'version_conflict_engine_exception'
    ));
    if (failures.length) throw new OpenSearchError('OpenSearch bulk indexing partially failed.', {
      code: 'OPENSEARCH_BULK_FAILED', retryable: failures.some((item) => RETRYABLE_STATUS.has(item.index?.status)),
      details: { failed: failures.length, firstType: failures[0]?.index?.error?.type || null },
    });
    return response.data?.items?.length || docs.length;
  }

  async index(docs = [], { target = null, canonical = true } = {}) {
    if (!docs.length) return { indexed: 0 };
    if (docs.length > MAX_BULK_DOCS) throw new OpenSearchError(`OpenSearch bulk size exceeds ${MAX_BULK_DOCS}.`, { status: 400, code: 'OPENSEARCH_BULK_TOO_LARGE' });
    let externalDocs = docs;
    if (canonical) {
      await this.canonical.index(docs);
      // Canonical updates are partial `$set`s. Rehydrate the merged source so
      // independently materialized analytics signals are never erased from
      // OpenSearch by an unrelated listing/catalog event.
      if (typeof this.canonical.findByKeys === 'function') {
        externalDocs = await this.canonical.findByKeys(docs.map((doc) => doc.key));
      }
    }
    await this.ensureReady();
    const destination = target || this.writeAlias;
    const indexed = await this.bulk(externalDocs, destination);
    if (!target) {
      const rebuilding = await this.rebuildTarget();
      if (rebuilding) await this.bulk(externalDocs, rebuilding);
    }
    return { indexed };
  }

  async remove(keys = []) {
    if (!keys.length) return { removed: 0 };
    await this.canonical.remove(keys);
    await this.ensureReady();
    const targets = [this.writeAlias];
    const rebuilding = await this.rebuildTarget();
    if (rebuilding) targets.push(rebuilding);
    for (const target of targets) {
      let payload = '';
      for (const key of keys) payload += `${JSON.stringify({ delete: { _index: target, _id: key } })}\n`;
      // Alias deletes are deliberately sequential because both targets must be durably cleared before success is reported.
      // eslint-disable-next-line no-await-in-loop
      await this.transport.request('/_bulk', { method: 'POST', body: payload, ndjson: true });
    }
    return { removed: keys.length };
  }

  async retrieve({ tenantId, parsed, filters = {}, limit = config.search.opensearch.candidateCap }) {
    await this.ensureReady();
    const response = await this.transport.request(`/${this.readAlias}/_search`, { method: 'POST', body: {
      size: Math.min(5000, Math.max(1, limit)), track_total_hits: false,
      query: searchQuery(parsed, { ...filters, tenantId }),
      _source: true,
    } });
    return (response.data?.hits?.hits || []).map((hit) => ({ ...hit._source, _id: hit._id, _providerScore: hit._score }));
  }

  async facets({ tenantId, parsed, filters = {} }) {
    await this.ensureReady();
    const response = await this.transport.request(`/${this.readAlias}/_search`, { method: 'POST', body: {
      size: 0, track_total_hits: false, query: searchQuery(parsed, { ...filters, tenantId }),
      aggs: {
        categories: { terms: { field: 'categoryId', size: 30 } },
        brands: { terms: { field: 'brandId', size: 30 } },
        availability: { terms: { field: 'inStock', size: 2 } },
        price: { stats: { field: 'pricePaise' } },
      },
    } });
    const aggs = response.data?.aggregations || {};
    const availability = aggs.availability?.buckets || [];
    return {
      categories: (aggs.categories?.buckets || []).map((bucket) => ({ id: String(bucket.key), name: null, count: bucket.doc_count })),
      brands: (aggs.brands?.buckets || []).map((bucket) => ({ id: String(bucket.key), name: null, count: bucket.doc_count })),
      inStock: availability.find((bucket) => bucket.key_as_string === 'true' || bucket.key === 1)?.doc_count || 0,
      outOfStock: availability.find((bucket) => bucket.key_as_string === 'false' || bucket.key === 0)?.doc_count || 0,
      priceRange: Number.isFinite(aggs.price?.min) ? { min: aggs.price.min / 100, max: aggs.price.max / 100 } : null,
    };
  }

  async suggest({ tenantId, prefix, limit = 8 }) {
    const value = String(prefix || '').trim();
    if (value.length < 2) return [];
    await this.ensureReady();
    const response = await this.transport.request(`/${this.readAlias}/_search`, { method: 'POST', body: {
      size: Math.min(30, limit * 3), _source: ['title', 'suggest'],
      query: { bool: { filter: filterClauses(tenantId), must: [{ multi_match: {
        query: escapeQuery(value), fields: ['title^3', 'suggest'], type: 'bool_prefix', operator: 'and',
      } }] } },
    } });
    const seen = new Set();
    const output = [];
    for (const hit of response.data?.hits?.hits || []) {
      const source = hit._source || {};
      const candidate = (source.suggest || []).find((term) => String(term).toLowerCase().startsWith(value.toLowerCase())) || source.title;
      if (!candidate || seen.has(String(candidate).toLowerCase())) continue;
      seen.add(String(candidate).toLowerCase());
      output.push({ text: candidate, title: source.title });
      if (output.length >= limit) break;
    }
    return output;
  }

  vocabulary(args) { return this.canonical.vocabulary(args); }

  async health() {
    try {
      await this.ensureReady();
      const [cluster, count, rebuilding] = await Promise.all([
        this.transport.request('/_cluster/health'),
        this.transport.request(`/${this.readAlias}/_count`),
        this.rebuildTarget(),
      ]);
      return {
        provider: this.name, ok: !['red'].includes(cluster.data?.status), status: cluster.data?.status || 'unknown',
        documents: count.data?.count || 0, timedOut: Boolean(cluster.data?.timed_out),
        rebuild: rebuilding ? { active: true, target: rebuilding } : { active: false },
      };
    } catch (error) {
      return { provider: this.name, ok: false, error: error.code || 'OPENSEARCH_UNAVAILABLE' };
    }
  }

  async beginReindex() {
    await this.ensureReady();
    const existing = await this.transport.request(`/_alias/${this.rebuildAlias}`, { allow404: true });
    if (existing.status !== 404) throw new OpenSearchError('An OpenSearch rebuild is already active.', { status: 409, code: 'OPENSEARCH_REINDEX_ACTIVE' });
    try {
      // Creating a fixed-name index is an atomic distributed lock across every
      // API/worker process; only one concurrent rebuild can win.
      await this.transport.request(`/${this.rebuildLock}`, {
        method: 'PUT', body: { settings: { index: { hidden: true, number_of_shards: 1, number_of_replicas: 0 } } }, retry: false,
      });
    } catch (error) {
      if (error.details?.type === 'resource_already_exists_exception') {
        throw new OpenSearchError('An OpenSearch rebuild is already active.', { status: 409, code: 'OPENSEARCH_REINDEX_ACTIVE' });
      }
      throw error;
    }
    const target = this.versionedName();
    try {
      await this.createIndex(target);
      await this.transport.request('/_aliases', { method: 'POST', body: { actions: [{ add: { index: target, alias: this.rebuildAlias } }] } });
    } catch (error) {
      await this.transport.request(`/${this.rebuildLock}`, { method: 'DELETE', allow404: true, retry: false }).catch(() => {});
      throw error;
    }
    this.rebuildTargetCache = { value: target, until: Date.now() + 2000 };
    return { target };
  }

  async completeReindex(target) {
    const aliases = await this.transport.request(`/_alias/${this.readAlias}`);
    const old = Object.keys(aliases.data || {});
    const actions = [];
    for (const index of old) {
      actions.push(
        { remove: { index, alias: this.readAlias, must_exist: false } },
        { remove: { index, alias: this.writeAlias, must_exist: false } },
      );
    }
    actions.push(
      { remove: { index: target, alias: this.rebuildAlias } },
      { add: { index: target, alias: this.readAlias } },
      { add: { index: target, alias: this.writeAlias, is_write_index: true } },
    );
    // Refresh can still fail safely before cutover. After the atomic alias move
    // succeeds, cleanup is best-effort and must never trigger deletion of the
    // newly active index from the caller's abort path.
    await this.transport.request(`/${target}/_refresh`, { method: 'POST' });
    try {
      await this.transport.request('/_aliases', { method: 'POST', body: { actions } });
    } catch (error) {
      throw new OpenSearchError('OpenSearch alias cutover outcome is uncertain; automatic deletion is disabled.', {
        status: 503, code: 'OPENSEARCH_CUTOVER_UNCERTAIN', retryable: false,
        details: { cause: error.code || 'OPENSEARCH_ERROR', target },
      });
    }
    this.rebuildTargetCache = { value: null, until: Date.now() + 2000 };
    await this.transport.request(`/${this.rebuildLock}`, { method: 'DELETE', allow404: true, retry: false }).catch(() => {});
    return { activated: target, replaced: old };
  }

  async abortReindex(target) {
    await this.transport.request(`/_aliases`, { method: 'POST', body: { actions: [{ remove: { index: target, alias: this.rebuildAlias } }] } }).catch(() => {});
    await this.transport.request(`/${target}`, { method: 'DELETE', allow404: true, retry: false }).catch(() => {});
    await this.transport.request(`/${this.rebuildLock}`, { method: 'DELETE', allow404: true, retry: false }).catch(() => {});
    this.rebuildTargetCache = { value: null, until: Date.now() + 2000 };
  }
}

export default OpenSearchProvider;
