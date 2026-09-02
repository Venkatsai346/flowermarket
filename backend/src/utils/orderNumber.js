import mongoose from 'mongoose';

/**
 * Order number generator — per-tenant daily sequence via an atomic counter
 * document (counters collection). e.g. FM-260831-00042
 *
 * findOneAndUpdate with $inc is atomic, so concurrent checkouts get unique,
 * gapless-per-day numbers.
 */
export async function nextOrderNumber({ tenantId }) {
  const now = new Date();
  const yymmdd = `${String(now.getUTCFullYear()).slice(-2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;

  const Counter = mongoose.models.Counter
    || mongoose.model('Counter', new mongoose.Schema({
      key: { type: String, required: true, unique: true },
      seq: { type: Number, default: 0 },
    }, { collection: 'counters' }));

  const key = `order:${tenantId}:${yymmdd}`;
  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `FM-${yymmdd}-${String(doc.seq).padStart(5, '0')}`;
}

export default nextOrderNumber;
