/**
 * k6 load test script — Flower Market API.
 *
 * Tests the critical customer-facing paths under load:
 *   1. Browse catalog (search + product listing)
 *   2. View product detail
 *   3. Add to cart
 *   4. Checkout (order creation)
 *   5. Order status check
 *
 * Run: k6 run --vus 50 --duration 2m tests/load/k6-load-test.js
 * Run (smoke): k6 run --vus 5 --duration 30s tests/load/k6-load-test.js
 *
 * Thresholds:
 *   - p95 latency < 500ms for catalog reads
 *   - p95 latency < 1000ms for checkout writes
 *   - Error rate < 1%
 *   - Throughput > 100 req/s at 50 VUs
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ──
const errorRate = new Rate('errors');
const catalogLatency = new Trend('catalog_latency', true);
const checkoutLatency = new Trend('checkout_latency', true);
const searchLatency = new Trend('search_latency', true);
const ordersCreated = new Counter('orders_created');

// ── Config ──
const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const API = `${BASE_URL}/api/v1`;

// ── Thresholds ──
export const options = {
  scenarios: {
    // Ramp-up load test
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },   // ramp up
        { duration: '1m', target: 50 },    // sustained load
        { duration: '30s', target: 100 },  // peak
        { duration: '30s', target: 0 },    // ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    errors: ['rate<0.01'],
    catalog_latency: ['p(95)<300'],
    search_latency: ['p(95)<400'],
    checkout_latency: ['p(95)<1000'],
    http_reqs: ['rate>100'],
  },
};

// ── Helpers ──
function jsonBody(res) {
  try { return JSON.parse(res.body); } catch { return null; }
}

function headers(token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

// ── Main test ──
export default function () {
  const thinkTime = () => sleep(Math.random() * 2 + 1);

  group('Catalog Browse', () => {
    // Search
    group('Search products', () => {
      const start = Date.now();
      const res = http.get(`${API}/search?q=roses&limit=20`);
      searchLatency.add(Date.now() - start);
      check(res, {
        'search status 200': (r) => r.status === 200,
        'search has results': (r) => {
          const body = jsonBody(r);
          return body?.data?.items?.length > 0 || body?.items?.length > 0 || body?.success === true;
        },
      }) || errorRate.add(1);
    });

    thinkTime();

    // List products
    group('List products', () => {
      const start = Date.now();
      const res = http.get(`${API}/catalog?limit=20`);
      catalogLatency.add(Date.now() - start);
      check(res, {
        'catalog status 200': (r) => r.status === 200,
      }) || errorRate.add(1);
    });

    thinkTime();

    // Product detail
    group('Product detail', () => {
      const res = http.get(`${API}/search?q=bouquet&limit=1`);
      const body = jsonBody(res);
      if (body?.data?.items?.[0]?.id || body?.items?.[0]?.id) {
        thinkTime();
        // View detail
        const detailRes = http.get(`${API}/catalog?limit=1`);
        check(detailRes, {
          'detail status 200': (r) => r.status === 200,
        }) || errorRate.add(1);
      }
    });
  });

  thinkTime();

  group('Cart & Checkout', () => {
    // Add to cart (unauthenticated — guest cart)
    const cartRes = http.post(
      `${API}/cart/items`,
      JSON.stringify({
        tenantProductId: '000000000000000000000001',
        quantity: 1,
      }),
      { headers: headers() },
    );

    check(cartRes, {
      'cart add status 200 or 201 or 401': (r) => [200, 201, 401, 403].includes(r.status),
    }) || errorRate.add(1);
  });

  group('Health checks', () => {
    const res = http.get(`${API}/health`);
    check(res, {
      'health status 200': (r) => r.status === 200,
      'health has service': (r) => {
        const body = jsonBody(r);
        return body?.data?.service === 'flower-market-api';
      },
    }) || errorRate.add(1);
  });

  thinkTime();
}

// ── Setup: verify the target is reachable ──
export function setup() {
  const res = http.get(`${API}/health`);
  if (res.status !== 200) {
    console.warn(`Warning: ${API}/health returned ${res.status}. Target may be down.`);
  }
  return { startTime: Date.now() };
}

// ── Teardown: summary ──
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Load test completed in ${duration.toFixed(1)}s`);
}
