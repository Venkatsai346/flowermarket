/**
 * Pin-aware delivery promise. Slots are India-local; never use UTC dates
 * or a customer in IST sees "today" flip at 5:30 am.
 */
export function kolkataDate(offsetDays = 0) {
  const ms = Date.now() + offsetDays * 86400000;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function slotWindow(slot) {
  if (!slot) return '';
  return slot.displayLabel || (slot.startTime && slot.endTime ? `${slot.startTime}–${slot.endTime}` : '');
}

export function formatArrival(slot, { lang = 'en' } = {}) {
  if (!slot) return null;
  const today = kolkataDate(0);
  const tomorrow = kolkataDate(1);
  const when = slot.date === today
    ? (lang === 'te' ? 'ఈరోజు' : 'today')
    : slot.date === tomorrow
      ? (lang === 'te' ? 'రేపు' : 'tomorrow')
      : slot.date;
  const window = slotWindow(slot);
  if (lang === 'te') return window ? `చేరుతుంది ${when} ${window}` : `చేరుతుంది ${when}`;
  return window ? `Arrives ${when} ${window}` : `Arrives ${when}`;
}

export function pickNextSlot(slots = []) {
  const list = Array.isArray(slots) ? slots : [];
  return list.find((s) => (s.remaining ?? s.availableCapacity ?? 1) > 0) || list[0] || null;
}

export default formatArrival;
