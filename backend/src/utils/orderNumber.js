import Counter from '../models/counter.model.js';

/**
 * Order number generator — per-tenant daily sequence via an atomic counter
 * document (counters collection). e.g. FM-260831-00042
 *
 * findOneAndUpdate with $inc is atomic, so concurrent checkouts get unique,
 * gapless-per-day numbers.
 *
 * NOTE: the Counter model's sequence field is `value` (shared with the
 * billing invoice counter — see models/counter.model.js). Do not reintroduce
 * a second field name: an unknown path is silently stripped by Mongoose's
 * strict casting, the $inc becomes a no-op, and every order number would be
 * `…-undefined`.
 */
export async function nextOrderNumber({ tenantId }) {
  const now = new Date();
  const yymmdd = `${String(now.getUTCFullYear()).slice(-2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;

  const key = `order:${tenantId}:${yymmdd}`;
  // findAndModify upserts do not guarantee to absorb the insert-vs-insert
  // race under concurrency: two checkouts can both miss the day's counter
  // row and both try to insert it, one of which gets E11000. Retry the
  // atomic $inc — on the second attempt the row exists (update path).
  let doc = null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      doc = await Counter.findOneAndUpdate(
        { key },
        { $inc: { value: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      break;
    } catch (err) {
      if (err?.code === 11000 && attempt < 5) continue;
      throw err;
    }
  }
  return `FM-${yymmdd}-${String(doc.value).padStart(5, '0')}`;
}

export default nextOrderNumber;
