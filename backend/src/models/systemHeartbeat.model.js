/**
 * SystemHeartbeat — one document per process role ('api', 'worker', …).
 *
 * The heartbeat is how an always-on consumer is OBSERVABLE from the API:
 * the worker upserts `lastBeatAt` every tick (default 5s); `/metrics`
 * exposes the age of that beat, so "is the worker alive" is a query, not a
 * guess. Absence of a fresh beat IS the down-signal (no tombstones needed).
 *
 * Counters are absolute process-lifetime totals written by the single
 * writer for the role (one worker per workerId is not guaranteed, so the
 * fields are "last reported by any instance" — a liveness snapshot, not an
 * aggregate).
 */

import mongoose from 'mongoose';
import { toJSONPlugin } from './plugins/index.js';

const { Schema } = mongoose;

const SystemHeartbeatSchema = new Schema(
  {
    // stable role key, e.g. 'api', 'worker'
    role: { type: String, required: true, unique: true, maxlength: 40 },
    // identity of the current writer (workerId / `api-<pid>`)
    id: { type: String, default: null, maxlength: 120 },
    pid: { type: Number, default: null },
    hostname: { type: String, default: null, maxlength: 200 },
    startedAt: { type: Date, default: null },
    lastBeatAt: { type: Date, default: Date.now },

    // worker-reported lifetime counters (informational)
    ticks: { type: Number, default: 0 },
    eventsPublished: { type: Number, default: 0 },
    eventsFailed: { type: Number, default: 0 },
    leasesReclaimed: { type: Number, default: 0 },
    jobsStarted: { type: Number, default: 0 },
  },
  { collection: 'systemheartbeats' }
);

SystemHeartbeatSchema.plugin(toJSONPlugin);

export default mongoose.model('SystemHeartbeat', SystemHeartbeatSchema);
