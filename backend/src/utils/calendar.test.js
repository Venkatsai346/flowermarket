import test from 'node:test';
import assert from 'node:assert/strict';
import { addDaysYmd, eachYmdInclusive, kolkataDate } from './calendar.js';

test('addDaysYmd walks civil dates across month ends', () => {
  assert.equal(addDaysYmd('2026-01-31', 1), '2026-02-01');
  assert.equal(addDaysYmd('2026-02-28', 1), '2026-03-01');
  assert.equal(addDaysYmd('2026-09-08', 0), '2026-09-08');
});

test('eachYmdInclusive is inclusive and ordered', () => {
  assert.deepEqual(eachYmdInclusive('2026-09-08', '2026-09-10'), [
    '2026-09-08', '2026-09-09', '2026-09-10',
  ]);
});

test('kolkataDate is YYYY-MM-DD', () => {
  assert.match(kolkataDate(0), /^\d{4}-\d{2}-\d{2}$/);
  const today = kolkataDate(0);
  assert.equal(kolkataDate(1), addDaysYmd(today, 1));
});
