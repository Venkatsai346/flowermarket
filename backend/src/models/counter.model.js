/**
 * Counter — atomic sequence values (Phase 5).
 *
 * Used for human-friendly unique numbers (invoice numbers INV-{YYMM}-{seq}).
 * findOneAndUpdate($inc, upsert) is atomic, so concurrent generation can never
 * collide. Key format is namespaced by purpose + month, e.g. `invoice:2609`.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema } = mongoose;

const CounterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Number, default: 0, min: 0 },
  },
  { collection: 'counters' }
);

CounterSchema.plugin(auditPlugin);
CounterSchema.plugin(softDeletePlugin);
CounterSchema.plugin(toJSONPlugin);

export default mongoose.model('Counter', CounterSchema);
