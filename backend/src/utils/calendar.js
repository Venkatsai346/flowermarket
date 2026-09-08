/**
 * India civil dates. Slot `date` is a YYYY-MM-DD in Asia/Kolkata, never UTC.
 * Adding 86400000 to a UTC instant and then formatting can skip/duplicate a
 * calendar day around midnight IST; these helpers stay on the civil date.
 */

export function kolkataDate(offsetDays = 0, from = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(from);
  const pick = (t) => Number(parts.find((p) => p.type === t)?.value);
  return addDaysYmd(
    `${pick('year')}-${String(pick('month')).padStart(2, '0')}-${String(pick('day')).padStart(2, '0')}`,
    offsetDays,
  );
}

/** Add `n` calendar days to a YYYY-MM-DD (no timezone). */
export function addDaysYmd(ymd, n = 0) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d + Number(n)));
  return dt.toISOString().slice(0, 10);
}

export function eachYmdInclusive(from, to) {
  const out = [];
  let cur = from;
  const guard = 400;
  for (let i = 0; i < guard && cur <= to; i += 1) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

export default { kolkataDate, addDaysYmd, eachYmdInclusive };
