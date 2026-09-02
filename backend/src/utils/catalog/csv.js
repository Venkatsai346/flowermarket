/**
 * Minimal CSV parser/serializer — zero dependencies.
 * Handles quoted fields, embedded commas/quotes and CRLF. Good enough for
 * tenant price/stock uploads (a few thousand rows). For very large files,
 * swap in a streaming parser later.
 */

/** Parse CSV text -> array of objects (first row = headers). */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  const s = String(text ?? '').replace(/^\uFEFF/, ''); // strip BOM
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // ignore (handle \r\n)
    } else {
      field += c;
    }
  }
  // trailing line without newline
  if (field !== '' || row.length > 0) pushRow();

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] !== undefined ? r[idx].trim() : '';
    });
    return obj;
  });
}

/** Serialize an array of objects to CSV. */
export function toCSV(rows, headers = null) {
  if (!rows || rows.length === 0) return '';
  const keys = headers || Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [keys.map(esc).join(',')];
  for (const r of rows) {
    lines.push(keys.map((k) => esc(r[k])).join(','));
  }
  return lines.join('\n');
}

export default parseCSV;
