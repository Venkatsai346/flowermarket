/**
 * HeartbeatService — liveness beacons for long-running processes.
 *
 * beat() is fire-and-forget by design: a metrics/heartbeat write must NEVER
 * fail the process that is beathing. Failures are swallowed silently (the
 * missing beat is itself the signal a monitor acts on).
 */

import os from 'node:os';
import SystemHeartbeat from '../models/systemHeartbeat.model.js';

async function beat(role, id, extra = {}) {
  try {
    await SystemHeartbeat.findOneAndUpdate(
      { role },
      {
        $set: {
          id,
          pid: process.pid,
          hostname: os.hostname(),
          lastBeatAt: new Date(),
          ...extra,
        },
        $setOnInsert: { startedAt: new Date(), role },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  } catch {
    // intentionally silent — a dead beat is louder than any error log
  }
}

async function latest(role) {
  return SystemHeartbeat.findOne({ role }).lean();
}

export default { beat, latest };
