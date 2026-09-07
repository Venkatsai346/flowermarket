/**
 * ScheduledJob — durable schedule row for built-in worker jobs.
 *
 * WHY PERSISTED (not in-memory timers):
 *  - single-flight across multiple worker processes: a run is CLAIMED by
 *    atomically advancing `nextRunAt` (findOneAndUpdate with the expected
 *    value) — only the winner executes.
 *  - survives worker restarts (no job is "forgotten" across a deploy).
 *  - observable in ops (lastRunAt/lastStatus/lastResult without scraping logs).
 *
 * Jobs are BUILT-IN (code-defined), rows are state. The worker upserts the
 * built-in set on boot, so no seeding migration is needed.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema } = mongoose;

const ScheduledJobSchema = new Schema(
  {
    // stable code name, e.g. 'tenant-nightly', 'marketplace-nightly'
    name: { type: String, required: true, unique: true, maxlength: 60 },
    // cadence descriptor (informational — the next-run math lives in the worker)
    schedule: { type: String, required: true, maxlength: 120 },
    nextRunAt: { type: Date, required: true, index: true },
    lastRunAt: { type: Date, default: null },
    lastStatus: { type: String, enum: ['ok', 'error', null], default: null },
    lastResult: { type: Schema.Types.Mixed, default: null },
    // who claimed the last run (worker id) — observability
    lastRunner: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'scheduledjobs' }
);

ScheduledJobSchema.plugin(auditPlugin);
ScheduledJobSchema.plugin(softDeletePlugin);
ScheduledJobSchema.plugin(toJSONPlugin);

export default mongoose.model('ScheduledJob', ScheduledJobSchema);
