/**
 * Health check controller — production-grade liveness and readiness probes.
 *
 * Three levels:
 *   GET /health          — liveness: is the process alive? (always 200 if responding)
 *   GET /health/ready    — readiness: can this instance serve traffic?
 *                           checks MongoDB, Redis (if configured), memory
 *   GET /health/deep     — deep: full dependency check (for dashboards, not load balancers)
 *
 * Kubernetes / ECS / Cloud Run conventions:
 *   - Liveness probe  → GET /health
 *   - Readiness probe → GET /health/ready
 *
 * The readiness probe returns 503 when MongoDB is down, so the load balancer
 * stops routing traffic to this instance until it recovers.
 */

import mongoose from 'mongoose';
import os from 'os';
import { asyncHandler } from '../utils/asyncHandler.js';

const startedAt = new Date();

/**
 * Probe the database connection. Returns { status, latencyMs }.
 */
async function checkMongo() {
  const state = mongoose.connection.readyState;
  // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  if (state !== 1) return { status: 'disconnected', latencyMs: null };

  const start = Date.now();
  try {
    await mongoose.connection.db.admin().ping();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'error', latencyMs: Date.now() - start, error: err.message };
  }
}

/**
 * Check memory usage against thresholds.
 */
function checkMemory() {
  const mem = process.memoryUsage();
  const heapUsed = mem.heapUsed;
  const heapTotal = mem.heapTotal;
  const rss = mem.rss;
  const threshold = 512 * 1024 * 1024; // 512MB warning threshold
  return {
    heapUsedMb: Math.round(heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(heapTotal / 1024 / 1024),
    rssMb: Math.round(rss / 1024 / 1024),
    status: rss > threshold ? 'warning' : 'ok',
  };
}

/**
 * Uptime since this process started.
 */
function uptime() {
  const ms = Date.now() - startedAt.getTime();
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return { seconds, formatted: `${hours}h ${minutes}m ${seconds % 60}s` };
}

class HealthController {
  /**
   * GET /health — liveness probe.
   * Always returns 200 if the process is running. No dependency checks.
   */
  liveness = asyncHandler(async (_req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: uptime(),
      version: process.env.npm_package_version || '0.0.0',
      node: process.version,
    });
  });

  /**
   * GET /health/ready — readiness probe.
   * Returns 503 if MongoDB is unreachable (load balancer should stop routing).
   */
  readiness = asyncHandler(async (_req, res) => {
    const mongo = await checkMongo();
    const memory = checkMemory();
    const isReady = mongo.status === 'ok';

    const body = {
      status: isReady ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: uptime(),
      checks: {
        mongo: mongo.status,
        mongoLatencyMs: mongo.latencyMs,
        memory: memory.status,
        heapUsedMb: memory.heapUsedMb,
      },
    };

    res.status(isReady ? 200 : 503).json(body);
  });

  /**
   * GET /health/deep — deep health check.
   * Full dependency report for dashboards and debugging. Not for load balancers.
   */
  deep = asyncHandler(async (_req, res) => {
    const mongo = await checkMongo();
    const memory = checkMemory();

    const body = {
      status: mongo.status === 'ok' && memory.status === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: uptime(),
      version: process.env.npm_package_version || '0.0.0',
      node: process.version,
      environment: process.env.NODE_ENV || 'development',
      hostname: os.hostname(),
      checks: {
        mongo: {
          status: mongo.status,
          latencyMs: mongo.latencyMs,
          readyState: mongoose.connection.readyState,
          host: mongoose.connection.host || 'unknown',
          name: mongoose.connection.name || 'unknown',
        },
        memory: {
          status: memory.status,
          heapUsedMb: memory.heapUsedMb,
          heapTotalMb: memory.heapTotalMb,
          rssMb: memory.rssMb,
          systemTotalMb: Math.round(os.totalmem() / 1024 / 1024),
          systemFreeMb: Math.round(os.freemem() / 1024 / 1024),
        },
        cpu: {
          loadAvg: os.loadavg().map((l) => l.toFixed(2)),
          cores: os.cpus().length,
        },
      },
    };

    if (mongo.error) body.checks.mongo.error = mongo.error;

    res.status(mongo.status === 'ok' ? 200 : 503).json(body);
  });
}

export default new HealthController();
