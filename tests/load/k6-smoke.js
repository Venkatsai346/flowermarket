/**
 * k6 smoke test — quick validation that the API is functional.
 *
 * Designed for CI: 1 VU, 30 seconds, just verifies critical paths respond.
 *
 * Run: k6 run tests/load/k6-smoke.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');
const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const API = `${BASE_URL}/api/v1`;

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    errors: ['rate<0.1'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  // Health
  const health = http.get(`${API}/health`);
  check(health, { 'health ok': (r) => r.status === 200 }) || errorRate.add(1);
  sleep(0.5);

  // Search
  const search = http.get(`${API}/search?q=test&limit=5`);
  check(search, { 'search ok': (r) => r.status === 200 }) || errorRate.add(1);
  sleep(0.5);

  // Catalog
  const catalog = http.get(`${API}/catalog?limit=5`);
  check(catalog, { 'catalog ok': (r) => r.status === 200 }) || errorRate.add(1);
  sleep(0.5);
}
