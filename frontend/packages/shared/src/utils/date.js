/** Date helpers — ISO strings in/out, Indian-locale display. */
export const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
export const todayISO = () => iso(new Date());
export const daysAgoISO = (n) => iso(new Date(Date.now() - n * 86400000));
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);

/** 12 Aug 2026 */
export const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** 12 Aug 2026, 14:05 */
export const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

/** 14:05 */
export const fmtTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};

/** 3d ago / 2h ago / now */
export const relTime = (d) => {
  if (!d) return '—';
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
};

/** {from, to} ISO covering the last n days (inclusive of today). */
export const dayRange = (n) => ({ from: daysAgoISO(n - 1), to: todayISO() });

/** 1 Aug – 31 Aug 2026 */
export const periodLabel = (p) => {
  if (!p) return '—';
  return `${fmtDate(p.from)} – ${fmtDate(p.to)}`;
};

/** days remaining until a date (0 if past) */
export const daysUntil = (d) => {
  if (!d) return null;
  return Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000));
};
