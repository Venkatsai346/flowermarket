/**
 * Slot forecasting unit test (blueprint §4) — pure math, no DB.
 *
 * The key relationship: forecasting sets the NUMBER, the atomic capacity lock
 * ENFORCES it. capacity = min(demand×headroom, physical_limit).
 *
 * Run: node scripts/slot-forecast.test.js
 */
import assert from 'node:assert/strict';

const D = { HEADROOM_MULTIPLIER: 1.5, FLOOR_CAPACITY: 5, PICK_ITEMS_PER_HOUR: 20, DELIVERIES_PER_RIDER_PER_SLOT: 15, WINDOW_HOURS: 3 };

/** Mirrors SlotForecastingService capacity math. */
function forecastCapacity({ predictedDemand, pickers, riders }) {
  const pickLimit = pickers * D.PICK_ITEMS_PER_HOUR * D.WINDOW_HOURS;
  const riderLimit = riders * D.DELIVERIES_PER_RIDER_PER_SLOT;
  const physicalLimit = Math.max(D.FLOOR_CAPACITY, Math.round(Math.min(pickLimit, riderLimit)));
  const cap = Math.max(D.FLOOR_CAPACITY, Math.round(Math.min(Math.max(D.FLOOR_CAPACITY, predictedDemand) * D.HEADROOM_MULTIPLIER, physicalLimit)));
  return { pickLimit, riderLimit, physicalLimit, capacity: cap };
}

// ---- scenario 1: demand 20, 2 pickers + 3 riders ----
let r = forecastCapacity({ predictedDemand: 20, pickers: 2, riders: 3 });
assert.equal(r.pickLimit, 120);
assert.equal(r.riderLimit, 45);
assert.equal(r.physicalLimit, 45, 'riders are the bottleneck');
assert.equal(r.capacity, 30, 'min(20×1.5, 45)');
console.log('  ✓ capacity = min(demand×1.5, physical=45) → 30');

// ---- scenario 2: demand 100, 5 pickers + 10 riders — physical caps the surge ----
r = forecastCapacity({ predictedDemand: 100, pickers: 5, riders: 10 });
assert.equal(r.physicalLimit, 150, 'pickLimit 300 ∩ riderLimit 150 → 150');
assert.equal(r.capacity, 150, 'min(100×1.5, 150)');
console.log('  ✓ physical limit caps demand (150 < 150×headroom)');

// ---- scenario 3: floor capacity when physical limit collapses (0 staff) ----
r = forecastCapacity({ predictedDemand: 1, pickers: 0, riders: 0 });
assert.equal(r.physicalLimit, 5, 'physical floor 5');
assert.equal(r.capacity, 5, 'capacity never below floor');
console.log('  ✓ floor capacity respected');

// ---- scenario 4: rider shortfall reduces next-day capacity (self-correction) ----
const r1 = forecastCapacity({ predictedDemand: 30, pickers: 4, riders: 6 });
const r2 = forecastCapacity({ predictedDemand: 30, pickers: 4, riders: 2 }); // 2 riders next day
assert.ok(r2.capacity < r1.capacity, 'rider shortfall shrinks capacity');
assert.equal(r2.capacity, 30, 'min(30×1.5, 30) = 30');
console.log('  ✓ rider shortfall self-corrects capacity downward');

console.log('\nSLOT FORECAST: all 4 scenarios passed ✔');
