import test from 'node:test';
import assert from 'node:assert/strict';
import { asList } from './utils.js';

test('asList unwraps the shapes list endpoints actually return', () => {
  assert.deepEqual(asList([1, 2]), [1, 2]);
  assert.deepEqual(asList({ items: [1] }), [1]);
  assert.deepEqual(asList({ addresses: [{ id: 'a' }] }), [{ id: 'a' }]);
  assert.deepEqual(asList({ slots: [] }), []);
  assert.deepEqual(asList(null), []);
  assert.deepEqual(asList({}), []);
});
