import assert from 'node:assert/strict';
import { orderStatusFor } from '../src/services/shipment.service.js';
import { combinations } from '../src/services/warehouseAllocation.service.js';
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

assert.deepEqual(combinations(['a', 'b', 'c'], 2), [['a', 'b'], ['a', 'c'], ['b', 'c']]);
assert.deepEqual(combinations(['a', 'b'], 1), [['a'], ['b']]);
assert.deepEqual(combinations(['a'], 2), []);

console.log('shipment orchestration: aggregate lifecycle and bounded combinations passed');
