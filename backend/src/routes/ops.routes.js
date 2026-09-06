/**
 * Ops endpoints — liveness, readiness and metrics. Mounted at the APP ROOT,
 * before tenant-context/auth/rate-limiting and before morgan (scrape
 * traffic must not pollute access logs or need a tenant header):
 *
 *   GET /healthz  — LIVENESS. "Is the process up and its event loop
 *                   responsive?" Deliberately DB-free: a Mongo outage must
 *                   NOT make the container look dead (restarts would not
 *                   help and would churn a healthy process).
 *   GET /readyz   — READINESS. "Can this instance take traffic right now?"
 *                   200 only when the Mongo connection is ready; 503 with a
 *                   machine-readable reason otherwise. This is what a LB /
 *                   orchestrator gates on.
 *   GET /metrics  — Prometheus text exposition (version 0.0.4). Dynamic
 *                   gauges are recomputed per scrape (see registry.js).
 */

import mongoose from 'mongoose';
import { Router } from 'express';
import { collectDynamic, registry } from '../observability/registry.js';

const router = Router();

router.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'flower-market-api',
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

router.get('/readyz', (req, res) => {
  const db = mongoose.connection.readyState === 1;
  res.status(db ? 200 : 503).json({
    status: db ? 'ready' : 'not_ready',
    checks: { db },
  });
});

router.get('/metrics', async (req, res) => {
  try {
    await collectDynamic();
  } catch {
    // even a total collect failure must not 500 the scrape
  }
  res
    .status(200)
    .type('text/plain; version=0.0.4; charset=utf-8')
    .send(registry.render());
});

export default router;
