import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderStatusFor } from '../src/services/shipment.service.js';
import { combinations } from '../src/services/warehouseAllocation.service.js';
import { composeOrderLifecycle } from '../src/utils/orderLifecycle.js';
import { permitsClaim, resolveReturnPolicy } from '../src/utils/returnPolicy.js';
import { ORDER_STATUS } from '../src/constants/enums.js';

const shipment = (status) => ({ status });

assert.equal(orderStatusFor([shipment('queued'), shipment('queued')]), ORDER_STATUS.CONFIRMED);
assert.equal(orderStatusFor([shipment('picking'), shipment('queued')]), ORDER_STATUS.PICKING);
assert.equal(orderStatusFor([shipment('packed'), shipment('packed')]), ORDER_STATUS.PACKED);
assert.equal(orderStatusFor([shipment('out_for_delivery'), shipment('packed')]), ORDER_STATUS.OUT_FOR_DELIVERY);
assert.equal(orderStatusFor([shipment('delivered'), shipment('packed')]), ORDER_STATUS.PARTIALLY_DELIVERED);
assert.equal(orderStatusFor([shipment('delivered'), shipment('delivered')]), ORDER_STATUS.DELIVERED);
assert.equal(orderStatusFor([shipment('cancelled'), shipment('delivered')]), ORDER_STATUS.DELIVERED);
assert.equal(orderStatusFor([shipment('cancelled'), shipment('cancelled')]), ORDER_STATUS.CANCELLED);
assert.equal(orderStatusFor([shipment('delivery_failed'), shipment('picking')]), ORDER_STATUS.DELIVERY_FAILED);
assert.equal(orderStatusFor([shipment('return_to_origin'), shipment('packed')]), ORDER_STATUS.DELIVERY_FAILED);
assert.equal(orderStatusFor([shipment('returned_to_origin'), shipment('packed')]), ORDER_STATUS.DELIVERY_FAILED);

assert.deepEqual(combinations(['a', 'b', 'c'], 2), [['a', 'b'], ['a', 'c'], ['b', 'c']]);
assert.deepEqual(combinations(['a', 'b'], 1), [['a'], ['b']]);
assert.deepEqual(combinations(['a'], 2), []);

// Compatibility and conservation guardrails are intentionally asserted at the
// orchestration boundary as well as through CI's Mongo-backed suites. This
// catches a future "simplification" that reintroduces either production bug.
const shipmentSource = readFileSync(new URL('../src/services/shipment.service.js', import.meta.url), 'utf8');
assert.match(shipmentSource, /rows\.length !== 1/, 'legacy delivery repair must remain single-shipment only');
assert.match(shipmentSource, /fulfillmentAllocation\?\.warehouseId \|\| null/,
  'cancellation must restore the immutable allocated inventory pool, including the legacy null pool');
assert.match(shipmentSource, /INVENTORY_RESERVATION_DRIFT/,
  'reservation quantity drift must fail closed');
assert.match(shipmentSource, /qtyReserved: -line\.qty/,
  'an active hold must release reserved quantity rather than manufacture on-hand stock');
assert.match(shipmentSource, /else if \(!reservation\)/,
  'historical orders without durable reservations must use the exact-node compatibility path');

const perishable = resolveReturnPolicy({ type: 'milk', isPerishable: true });
assert.equal(perishable.mode, 'quality_claim_only');
assert.equal(permitsClaim(perishable, 'pickup_qc'), false);
assert.equal(permitsClaim(perishable, 'instant_claim'), true);
const finalSale = resolveReturnPolicy({ returnPolicy: { mode: 'final_sale' } });
assert.equal(permitsClaim(finalSale, 'instant_claim'), false);

const returned = composeOrderLifecycle(
  { status: 'delivered', paymentSummary: { status: 'refunded', refundedAmount: 500 } },
  [{ _id: 'r1', status: 'refunded', updatedAt: new Date() }],
);
assert.equal(returned.fulfillment.status, 'delivered', 'returns must not erase delivery history');
assert.equal(returned.afterSales.status, 'refunded');
assert.equal(returned.customerStatus, 'refunded', 'customer headline must reflect the current outcome');

console.log('shipment orchestration: lifecycle, policy, compatibility, and conservation passed');
