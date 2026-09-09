/**
 * API Contract Tests — validates that API responses match expected schemas.
 *
 * Uses pure assertions (no Joi dependency) so this test can run from the repo
 * root without requiring backend's node_modules.
 *
 * Run: node tests/contract/api-contracts.test.js
 */

import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

function ok(name) { passed += 1; console.log(`  ✅ ${name}`); }
function fail(name, err) { failed += 1; console.error(`  ❌ ${name}: ${err}`); }

// ── Schema validators (pure JS, no dependencies) ──
function assertType(val, type, path) {
  if (typeof val !== type) throw new Error(`${path}: expected ${type}, got ${typeof val}`);
}
function assertShape(obj, shape, path = '') {
  for (const [key, spec] of Object.entries(shape)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (spec.required && !(key in obj)) throw new Error(`${fullPath}: missing required field`);
    if (!(key in obj)) continue;
    const val = obj[key];
    if (spec.type === 'array') {
      if (!Array.isArray(val)) throw new Error(`${fullPath}: expected array`);
    } else if (spec.type === 'object') {
      if (val !== null && typeof val !== 'object') throw new Error(`${fullPath}: expected object`);
      if (spec.shape && val) assertShape(val, spec.shape, fullPath);
    } else if (spec.type) {
      assertType(val, spec.type, fullPath);
    }
    if (spec.min !== undefined && val < spec.min) throw new Error(`${fullPath}: ${val} < min ${spec.min}`);
    if (spec.max !== undefined && val > spec.max) throw new Error(`${fullPath}: ${val} > max ${spec.max}`);
    if (spec.enum && !spec.enum.includes(val)) throw new Error(`${fullPath}: ${val} not in [${spec.enum}]`);
    if (spec.validate) spec.validate(val, fullPath);
  }
}

// ── Response schemas ──
const schemas = {
  health: {
    success: { type: 'boolean', required: true },
    message: { type: 'string', required: true },
    data: {
      type: 'object', required: true,
      shape: {
        service: { type: 'string', required: true },
        tenantId: { required: true }, // string or null
      },
    },
  },
  paginatedList: {
    success: { type: 'boolean', required: true },
    items: { type: 'array', required: true },
    meta: {
      type: 'object', required: true,
      shape: {
        page: { type: 'number', required: true, min: 1 },
        limit: { type: 'number', required: true, min: 1 },
        total: { type: 'number', required: true, min: 0 },
        totalPages: { type: 'number', required: true, min: 0 },
        hasMore: { type: 'boolean', required: true },
      },
    },
  },
  searchResponse: {
    success: { type: 'boolean', required: true },
    data: {
      type: 'object', required: true,
      shape: {
        items: { type: 'array', required: true },
        meta: {
          type: 'object', required: true,
          shape: {
            page: { type: 'number', required: true },
            limit: { type: 'number', required: true },
            total: { type: 'number', required: true },
          },
        },
      },
    },
  },
  errorResponse: {
    success: { type: 'boolean', required: true },
    error: {
      type: 'object', required: true,
      shape: {
        message: { type: 'string', required: true },
        code: { type: 'string', required: true },
      },
    },
  },
  review: {
    id: { type: 'string', required: true },
    tenantId: { type: 'string', required: true },
    tenantProductId: { type: 'string', required: true },
    userId: { type: 'string', required: true },
    rating: { type: 'number', required: true, min: 1, max: 5 },
    title: { type: 'string', required: true },
    body: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'approved', 'rejected'] },
    isVerifiedPurchase: { type: 'boolean', required: true },
    helpfulCount: { type: 'number', required: true, min: 0 },
    createdAt: { type: 'string', required: true },
  },
  dlqStats: {
    depth: { type: 'number', required: true, min: 0 },
    oldestAgeMs: { type: 'number', required: true, min: 0 },
    byEventType: { type: 'object', required: true },
    byEntityType: { type: 'object', required: true },
    topErrors: { type: 'array', required: true },
  },
  poolStats: {
    state: { type: 'string', required: true, enum: ['disconnected', 'connected', 'connecting', 'disconnecting'] },
    readyState: { type: 'number', required: true },
    host: { type: 'string', required: true },
    name: { type: 'string', required: true },
    pool: { required: true }, // object or null
    config: {
      type: 'object', required: true,
      shape: {
        maxPoolSize: { type: 'number', required: true },
        minPoolSize: { type: 'number', required: true },
      },
    },
    pingMs: { required: true }, // number or null
    checkedAt: { type: 'string', required: true },
  },
  demandForecast: {
    forecasts: { type: 'array', required: true },
    meta: {
      type: 'object', required: true,
      shape: {
        weeks: { type: 'number', required: true },
        forecastWeeks: { type: 'number', required: true },
        method: { type: 'string', required: true, enum: ['simple', 'weighted', 'trend'] },
        productsAnalyzed: { type: 'number', required: true },
        reorderAlerts: { type: 'number', required: true },
      },
    },
  },
};

console.log('=== API Contract Tests ===\n');

// Test each schema with a valid sample
const samples = {
  health: { success: true, message: 'OK', data: { service: 'flower-market-api', tenantId: 'abc' } },
  paginatedList: {
    success: true, items: [{ id: '1' }],
    meta: { page: 1, limit: 20, total: 100, totalPages: 5, hasMore: true },
  },
  searchResponse: {
    success: true, data: { items: [{ id: '1', name: 'Rose' }], meta: { page: 1, limit: 20, total: 50 } },
  },
  errorResponse: { success: false, error: { message: 'Not found', code: 'NOT_FOUND' } },
  review: {
    id: 'rev1', tenantId: 't1', tenantProductId: 'p1', userId: 'u1',
    rating: 5, title: 'Great!', body: 'Love it', status: 'approved',
    isVerifiedPurchase: true, helpfulCount: 3, createdAt: '2024-01-01T00:00:00Z',
  },
  dlqStats: {
    depth: 5, oldestAgeMs: 120000,
    byEventType: { price_changed: 3 }, byEntityType: { listing: 3 },
    topErrors: [{ message: 'boom', count: 5 }],
  },
  poolStats: {
    state: 'connected', readyState: 1, host: 'localhost', name: 'flowermarket',
    pool: { current: 10, available: 90 },
    config: { maxPoolSize: 100, minPoolSize: 0 },
    pingMs: 2, checkedAt: new Date().toISOString(),
  },
  demandForecast: {
    forecasts: [{
      productId: 'p1', productName: 'Rose', currentStock: 100,
      avgWeeklyDemand: 20, forecastTotalDemand: 80, reorderNeeded: false,
      confidence: 0.85, trend: 'growing',
    }],
    meta: { weeks: 12, forecastWeeks: 4, method: 'weighted', productsAnalyzed: 1, reorderAlerts: 0 },
  },
};

for (const [name, schema] of Object.entries(schemas)) {
  try {
    assertShape(samples[name], schema);
    ok(`Schema "${name}" validates sample response`);
  } catch (err) {
    fail(`Schema "${name}"`, err.message);
  }
}

// Test: rejects missing required fields
try {
  assertShape({ success: true, message: 'OK' }, schemas.health);
  fail('Missing required', 'Should have thrown');
} catch {
  ok('Contract rejects missing required fields');
}

// Test: rejects wrong types
try {
  assertShape({ id: 123, rating: 'five' }, schemas.review);
  fail('Wrong types', 'Should have thrown');
} catch {
  ok('Contract rejects wrong types');
}

// Test: rejects out-of-range
try {
  assertShape({
    id: 'r1', tenantId: 't1', tenantProductId: 'p1', userId: 'u1',
    rating: 6, title: '', body: '', status: 'pending',
    isVerifiedPurchase: false, helpfulCount: 0, createdAt: '2024-01-01',
  }, schemas.review);
  fail('Out of range', 'Should have thrown');
} catch {
  ok('Contract rejects out-of-range values');
}

// Test: rejects invalid enum
try {
  assertShape({
    id: 'r1', tenantId: 't1', tenantProductId: 'p1', userId: 'u1',
    rating: 3, title: '', body: '', status: 'INVALID',
    isVerifiedPurchase: false, helpfulCount: 0, createdAt: '2024-01-01',
  }, schemas.review);
  fail('Invalid enum', 'Should have thrown');
} catch {
  ok('Contract rejects invalid enum values');
}

console.log(`\n=== API Contracts: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
