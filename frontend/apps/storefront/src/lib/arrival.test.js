import test from 'node:test';
import assert from 'node:assert/strict';
import { formatArrival, pickNextSlot, slotWindow, kolkataDate } from './arrival.js';

test('kolkataDate is YYYY-MM-DD', () => {
  assert.match(kolkataDate(0), /^\d{4}-\d{2}-\d{2}$/);
});

test('formatArrival uses today/tomorrow against Asia/Kolkata', () => {
  const today = kolkataDate(0);
  const copy = formatArrival({ date: today, displayLabel: '4–7 pm' });
  assert.equal(copy, 'Arrives today 4–7 pm');

  const te = formatArrival({ date: today, startTime: '16:00', endTime: '19:00' }, { lang: 'te' });
  assert.match(te, /చేరుతుంది ఈరోజు/);
});

test('pickNextSlot skips full windows', () => {
  const next = pickNextSlot([
    { id: 'a', remaining: 0 },
    { id: 'b', availableCapacity: 3 },
  ]);
  assert.equal(next.id, 'b');
  assert.equal(slotWindow({ startTime: '16:00', endTime: '19:00' }), '16:00–19:00');
});
