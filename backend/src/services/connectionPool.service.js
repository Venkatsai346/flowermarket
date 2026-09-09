/**
 * ConnectionPoolService — MongoDB connection pool monitoring.
 *
 * Exposes pool stats for observability (health checks, metrics, admin UI).
 * The pool is configured at connection time; this service reads the current
 * state from the Mongoose connection and driver internals.
 *
 * Stats available:
 *   - Current connections (active, available, total)
 *   - Pool configuration (min, max)
 *   - Connection state (connected, disconnected, connecting, disconnecting)
 *   - Server round-trip time (ping)
 *   - Recent operations (slow queries from profiling)
 */

import mongoose from 'mongoose';

const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

class ConnectionPoolService {
  /**
   * Get comprehensive pool stats.
   */
  async stats() {
    const conn = mongoose.connection;
    const state = STATES[conn.readyState] || 'unknown';
    const db = conn.db;

    let poolStats = null;
    let serverInfo = null;
    let pingMs = null;

    if (conn.readyState === 1 && db) {
      try {
        // Admin command to get server status (includes connection info)
        const admin = db.admin();
        const serverStatus = await admin.serverStatus();
        const connInfo = serverStatus.connections || {};

        poolStats = {
          current: connInfo.current || 0,
          available: connInfo.available || 0,
          totalCreated: connInfo.totalCreated || 0,
          active: connInfo.active || 0,
          // rejected is non-zero when pool is exhausted
          rejected: connInfo.rejected || 0,
        };

        serverInfo = {
          version: serverStatus.version || 'unknown',
          uptime: serverStatus.uptime || 0,
          host: serverStatus.host || 'unknown',
          process: serverStatus.process || 'mongod',
        };

        // Ping for RTT
        const pingStart = Date.now();
        await db.command({ ping: 1 });
        pingMs = Date.now() - pingStart;
      } catch {
        // Graceful degradation — don't fail health checks on monitoring errors
      }
    }

    // Mongoose-level config
    const config = {
      maxPoolSize: conn.config?.maxPoolSize || conn.options?.maxPoolSize || 100,
      minPoolSize: conn.config?.minPoolSize || conn.options?.minPoolSize || 0,
      maxIdleTimeMs: conn.config?.maxIdleTimeMs || conn.options?.maxIdleTimeMs || 0,
      waitQueueTimeoutMs: conn.config?.waitQueueTimeoutMs || conn.options?.waitQueueTimeoutMs || 0,
    };

    return {
      state,
      readyState: conn.readyState,
      host: conn.host || 'unknown',
      name: conn.name || 'unknown',
      pool: poolStats,
      config,
      server: serverInfo,
      pingMs,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Health check: returns true if the connection is healthy.
   */
  async isHealthy() {
    try {
      if (mongoose.connection.readyState !== 1) return false;
      await mongoose.connection.db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get slow operations from the current oplog (profiling).
   * Only works if profiling level >= 1.
   */
  async slowOps({ thresholdMs = 100, limit = 20 } = {}) {
    try {
      const db = mongoose.connection.db;
      if (!db) return [];

      const profileCollection = db.collection('system.profile');
      const ops = await profileCollection
        .find({ millis: { $gte: thresholdMs } })
        .sort({ ts: -1 })
        .limit(limit)
        .project({ ns: 1, op: 1, millis: 1, ts: 1, command: 1, planSummary: 1 })
        .toArray();

      return ops.map((op) => ({
        namespace: op.ns,
        operation: op.op,
        durationMs: op.millis,
        timestamp: op.ts,
        planSummary: op.planSummary || null,
        command: op.command ? JSON.stringify(op.command).slice(0, 200) : null,
      }));
    } catch {
      // Profiling not enabled — return empty
      return [];
    }
  }

  /**
   * Connection event log (in-memory, last N events).
   * Call registerListeners() once at boot.
   */
  _events = [];
  _maxEvents = 50;

  registerListeners() {
    const conn = mongoose.connection;
    const log = (type) => {
      this._events.unshift({ type, at: new Date().toISOString() });
      if (this._events.length > this._maxEvents) this._events.pop();
    };

    conn.on('connected', () => log('connected'));
    conn.on('disconnected', () => log('disconnected'));
    conn.on('reconnected', () => log('reconnected'));
    conn.on('error', (err) => log(`error: ${err?.message || 'unknown'}`));
    conn.on('close', () => log('close'));
  }

  getEvents() {
    return [...this._events];
  }
}

export default new ConnectionPoolService();
