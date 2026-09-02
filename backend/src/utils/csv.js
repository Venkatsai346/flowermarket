/**
 * csv — RFC-4180 CSV builder for admin exports.
 *
 * - Fields containing a comma, double-quote or newline are quoted; embedded
 *   quotes are doubled. Numbers are written plain; null/undefined = empty.
 * - toCsvString() prepends a UTF-8 BOM so Excel opens ₹/unicode correctly.
 */

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** rows: array of objects; headers: array of [key, label] pairs. */
export function toCsvString(rows, headers) {
  const head = headers.map(([, label]) => escapeCell(label)).join(',');
  const body = rows.map((row) => headers.map(([key]) => escapeCell(row?.[key])).join(','));
  return `\uFEFF${[head, ...body].join('\r\n')}\r\n`;
}

/** Express helper: send a CSV string as an attachment. */
export function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

export default { toCsvString, sendCsv };
