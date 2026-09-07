/**
 * Golden file — Indian MRP is GST-inclusive.
 *
 * Identity (gst.computeLineTax, pricesInclusive):
 *   taxable + tax === MRP   (exact, because tax = net − taxable)
 *   lineTotal      === MRP
 *
 * A ₹299 rose at 5% charges ₹299, not ₹314. Refunds reverse the same paise.
 *
 * Run: node scripts/inclusive-mrp.golden.test.js
 */
import assert from 'node:assert/strict';
import { computeLineTax } from '../src/utils/gst.js';
import { toPaise, fromPaise } from '../src/utils/money.js';

const STATE = '37';

const SKUS = [
  { name: 'Red rose bunch of 10', mrp: 299, ratePct: 5 },
  { name: 'Red rose bunch of 20', mrp: 499, ratePct: 5 },
  { name: 'White rose bunch of 12', mrp: 349, ratePct: 5 },
  { name: 'Loose mogra 100g', mrp: 149, ratePct: 5 },
  { name: 'Marigold malai', mrp: 89, ratePct: 5 },
  { name: 'Jasmine string', mrp: 79, ratePct: 5 },
  { name: 'Money plant', mrp: 249, ratePct: 5 },
  { name: 'Peace lily', mrp: 399, ratePct: 5 },
  { name: 'Snake plant', mrp: 449, ratePct: 5 },
  { name: 'Birthday bouquet 12 stems', mrp: 899, ratePct: 12 },
  { name: 'Sorry bouquet', mrp: 1299, ratePct: 12 },
  { name: 'Pooja mixed bunch', mrp: 199, ratePct: 5 },
  { name: 'Ceramic vase', mrp: 599, ratePct: 12 },
  { name: 'Glass vase', mrp: 449, ratePct: 18 },
  { name: 'Greeting card', mrp: 49, ratePct: 18 },
  { name: 'Ribbon wrap', mrp: 29, ratePct: 18 },
  { name: 'Teddy add-on', mrp: 399, ratePct: 18 },
  { name: 'Chocolate box', mrp: 249, ratePct: 18 },
  { name: 'Temple flowers (nil-rated)', mrp: 99, ratePct: 0 },
  { name: 'Seed packet (nil-rated)', mrp: 35, ratePct: 0 },
];

let pass = 0;
const ok = (l) => { pass += 1; console.log(`  ✓ ${l}`); };

for (const sku of SKUS) {
  const grossPaise = toPaise(sku.mrp);
  const computed = computeLineTax({
    grossPaise,
    rateBps: Math.round(sku.ratePct * 100),
    natureOfSupply: sku.ratePct > 0 ? 'taxable' : 'nil_rated',
    supplierStateCode: STATE,
    placeOfSupplyStateCode: STATE,
    pricesInclusive: true,
  });
  assert.equal(
    computed.taxableValuePaise + computed.totalTaxPaise,
    grossPaise,
    `${sku.name}: taxable + tax must equal MRP`,
  );
  assert.equal(computed.lineTotalPaise, grossPaise, `${sku.name}: line total is the shelf price`);
  if (sku.ratePct === 0) {
    assert.equal(computed.totalTaxPaise, 0, `${sku.name}: nil-rated carries 0 tax`);
    assert.equal(computed.taxableValuePaise, grossPaise);
  } else {
    assert.ok(computed.totalTaxPaise > 0, `${sku.name}: extracted tax is positive`);
    assert.ok(computed.taxableValuePaise < grossPaise, `${sku.name}: taxable is inside MRP`);
  }
  ok(`${sku.name} ₹${sku.mrp} @ ${sku.ratePct}% → tax ₹${fromPaise(computed.totalTaxPaise)}`);
}

// The launch identity: a ₹299 rose (5% incl.) charges ₹299, not ₹314.
{
  const rose = computeLineTax({
    grossPaise: toPaise(299),
    rateBps: 500,
    natureOfSupply: 'taxable',
    supplierStateCode: STATE,
    placeOfSupplyStateCode: STATE,
    pricesInclusive: true,
  });
  assert.equal(fromPaise(rose.lineTotalPaise), 299);
  assert.equal(fromPaise(rose.taxableValuePaise + rose.totalTaxPaise), 299);
  assert.notEqual(fromPaise(rose.lineTotalPaise), 314);
  ok('₹299 rose charges ₹299 (tax inside), never ₹314');
}

console.log(`\nINCLUSIVE MRP GOLDEN: ${pass} SKUs passed ✔`);
