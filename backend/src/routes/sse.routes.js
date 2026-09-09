/**
 * Server-Sent Events (SSE) — real-time push from server to client.
 *
 * Endpoints:
 *   GET /sse/orders     — live order feed (new orders, status changes)
 *   GET /sse/delivery   — live delivery tracking (rider location, ETA)
 *   GET /sse/activity   — live activity feed (any store event)
 *
 * Each endpoint:
 *   1. Sets SSE headers (Content-Type: text/event-stream)
 *   2. Registers the client in an in-memory subscriber list
 *   3. Pushes events as they occur (via catalogEvent service)
 *   4. Removes the client on disconnect
 *
 * For multi-instance deployments, use Redis Pub/Sub to broadcast
 * events across processes. This implementation works for single-instance.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate);

// In-memory subscriber registry per channel
const subscribers = {
  orders: new Set(),
  delivery: new Set(),
  activity: new Set(),
};

/**
 * Register an SSE client.
 */
function subscribe(channel, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ channel, time: new Date().toISOString() })}\n\n`);

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 30000);

  // Add to subscribers
  const client = { res, tenantId: req.tenantId, userId: req.user?._id };
  subscribers[channel].add(client);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers[channel].delete(client);
  });
}

/**
 * Broadcast an event to all subscribers of a channel.
 * Only sends to clients matching the tenantId.
 *
 * @param {string} channel - 'orders' | 'delivery' | 'activity'
 * @param {string} eventType - SSE event name
 * @param {Object} data - Event payload
 * @param {string} [tenantId] - Filter by tenant
 */
export function broadcast(channel, eventType, data, tenantId = null) {
  const clients = subscribers[channel];
  if (!clients?.size) return;

  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) {
    if (tenantId && String(client.tenantId) !== String(tenantId)) continue;
    try {
      client.res.write(payload);
    } catch {
      // Client disconnected — will be cleaned up on close event
      clients.delete(client);
    }
  }
}

// ── SSE Endpoints ──

router.get('/orders', (req, res) => {
  subscribe('orders', req, res);
});

router.get('/delivery', (req, res) => {
  subscribe('delivery', req, res);
});

router.get('/activity', (req, res) => {
  subscribe('activity', req, res);
});

/**
 * Get SSE stats (for monitoring).
 */
router.get('/stats', (req, res) => {
  const stats = {};
  for (const [channel, clients] of Object.entries(subscribers)) {
    stats[channel] = clients.size;
  }
  res.json({ success: true, data: stats });
});

export default router;
export { subscribers };
