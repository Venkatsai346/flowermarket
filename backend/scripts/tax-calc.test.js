/**
 * tax-calc.test.js — PURE GST engine tests (Phase 6.2). No database.
 *
 *   node scripts/tax-calc.test.js
 *
 * Every assertion here is a number a chartered accountant could check by hand.
 * That is the point: tax code that can only be verified by running the whole
 * stack is tax code nobody verifies.
 */

import {
  computeLineTax, buildHsnSummary, summariseInvoice, roundOffPaise,
  fyLabel, fyRange, isValidGstin, computeGstinChecksum, stateCodeFromName,
  stateCodeFromGstin, panFromGstin,
} from '../src/utils/gst.js';
import { toPaise, fromPaise } from '../src/utils/money.js';

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${expected}, got ${actual}`);
const eqRs = (name, actualPaise, expectedRupees) =>
  check(name, actualPaise === toPaise(expectedRupees), `expected ₹${expectedRupees}, got ₹${fromPaise(actualPaise)}`);
const section = (t) => console.log(`\n${t}`);

const AP = '37';   // supplier: Andhra Pradesh
const TS = '36';   // Telangana
const KA = '29';   // Karnataka

// ---------------------------------------------------------------------------
section('1. inclusive pricing — tax is backed OUT of the MRP');
// ---------------------------------------------------------------------------
{
  // ₹590 MRP at 18%, intra-state. The classic worked example.
  const r = computeLineTax({
    grossPaise: toPaise(590), rateBps: 1800,
    supplierStateCode: AP, placeOfSupplyStateCode: AP, pricesInclusive: true,
  });
  eqRs('taxable value = ₹500.00', r.taxableValuePaise, 500);
  eqRs('CGST = ₹45.00', r.cgstPaise, 45);
  eqRs('SGST = ₹45.00', r.sgstPaise, 45);
  eq('IGST = 0 (intra-state)', r.igstPaise, 0);
  eqRs('line total back to ₹590.00', r.lineTotalPaise, 590);
  check('flagged intra-state', r.intraState);
  eq('CGST + SGST === total tax', r.cgstPaise + r.sgstPaise, r.totalTaxPaise);
}

{
  // 5% slab, a price that does NOT divide cleanly
  const r = computeLineTax({
    grossPaise: toPaise(100.01), rateBps: 500,
    supplierStateCode: AP, placeOfSupplyStateCode: AP,
  });
  eqRs('₹100.01 @5% → taxable ₹95.25', r.taxableValuePaise, 95.25);
  eqRs('tax = ₹4.76', r.totalTaxPaise, 4.76);
  eqRs('CGST = ₹2.38', r.cgstPaise, 2.38);
  eqRs('SGST = ₹2.38', r.sgstPaise, 2.38);
  eq('halves still sum exactly', r.cgstPaise + r.sgstPaise, r.totalTaxPaise);
  eqRs('nothing lost: taxable + tax === gross', r.lineTotalPaise, 100.01);
}

{
  // odd number of paise in the tax — the case that breaks naive /2 code
  const r = computeLineTax({
    grossPaise: 10003, rateBps: 1800,
    supplierStateCode: AP, placeOfSupplyStateCode: AP,
  });
  eq('odd tax splits without losing a paisa', r.cgstPaise + r.sgstPaise, r.totalTaxPaise);
  check('the extra paisa goes to SGST', r.sgstPaise >= r.cgstPaise);
  eq('reconciles to the gross', r.taxableValuePaise + r.totalTaxPaise, 10003);
}

// ---------------------------------------------------------------------------
section('2. place of supply decides the tax heads');
// ---------------------------------------------------------------------------
{
  const inter = computeLineTax({
    grossPaise: toPaise(590), rateBps: 1800,
    supplierStateCode: AP, placeOfSupplyStateCode: KA,
  });
  eqRs('inter-state: IGST = ₹90.00', inter.igstPaise, 90);
  eq('inter-state: CGST = 0', inter.cgstPaise, 0);
  eq('inter-state: SGST = 0', inter.sgstPaise, 0);
  check('flagged inter-state', inter.intraState === false);

  const intra = computeLineTax({
    grossPaise: toPaise(590), rateBps: 1800,
    supplierStateCode: TS, placeOfSupplyStateCode: TS,
  });
  eq('same total tax either way — only the heads differ',
    intra.cgstPaise + intra.sgstPaise + intra.igstPaise,
    inter.cgstPaise + inter.sgstPaise + inter.igstPaise);
}

// ---------------------------------------------------------------------------
section('3. discounts reduce the transaction value BEFORE tax');
// ---------------------------------------------------------------------------
{
  const r = computeLineTax({
    grossPaise: toPaise(590), discountPaise: toPaise(59), rateBps: 1800,
    supplierStateCode: AP, placeOfSupplyStateCode: AP,
  });
  eqRs('₹590 − ₹59 = ₹531 net → taxable ₹450.00', r.taxableValuePaise, 450);
  eqRs('tax on the discounted value = ₹81.00', r.totalTaxPaise, 81);
  eqRs('line total = ₹531.00', r.lineTotalPaise, 531);

  let threw = null;
  try {
    computeLineTax({ grossPaise: 100, discountPaise: 200, rateBps: 1800, supplierStateCode: AP, placeOfSupplyStateCode: AP });
  } catch (e) { threw = e; }
  check('a discount larger than the line is rejected', threw instanceof RangeError);
}

// ---------------------------------------------------------------------------
section('4. nil-rated & exempt supplies — reported, not omitted');
// ---------------------------------------------------------------------------
{
  // fresh cut flowers: nil-rated, but the VALUE still appears on the invoice
  const r = computeLineTax({
    grossPaise: toPaise(250), rateBps: 0, natureOfSupply: 'nil_rated',
    supplierStateCode: AP, placeOfSupplyStateCode: AP,
  });
  eqRs('nil-rated: full value is taxable VALUE at 0%', r.taxableValuePaise, 250);
  eq('nil-rated: no tax', r.totalTaxPaise, 0);
  eq('nature preserved for GSTR-1 reporting', r.natureOfSupply, 'nil_rated');

  // exempt with a rate accidentally configured — nature wins
  const e = computeLineTax({
    grossPaise: toPaise(100), rateBps: 1800, natureOfSupply: 'exempt',
    supplierStateCode: AP, placeOfSupplyStateCode: AP,
  });
  eq('exempt ignores a stray rate', e.totalTaxPaise, 0);
  eq('effective rate reported as 0', e.effectiveRateBps, 0);
}

// ---------------------------------------------------------------------------
section('5. exclusive pricing mode (legacy pipeline compatibility)');
// ---------------------------------------------------------------------------
{
  const r = computeLineTax({
    grossPaise: toPaise(500), rateBps: 1800, pricesInclusive: false,
    supplierStateCode: AP, placeOfSupplyStateCode: AP,
  });
  eqRs('exclusive: taxable = the price itself ₹500', r.taxableValuePaise, 500);
  eqRs('exclusive: tax added on top = ₹90', r.totalTaxPaise, 90);
  eqRs('exclusive: line total = ₹590', r.lineTotalPaise, 590);
}

// ---------------------------------------------------------------------------
section('6. RECONSTRUCTION mode — the invoice must match what was charged');
// ---------------------------------------------------------------------------
{
  // The existing Phase 3.5 pipeline persisted lineTotal=₹5000 and taxAmount=₹900.
  // The invoice must reproduce exactly that, and only split it into heads —
  // never recompute from today's rate table.
  const r = computeLineTax({
    grossPaise: toPaise(5900), rateBps: 1800, knownTaxPaise: toPaise(900),
    supplierStateCode: AP, placeOfSupplyStateCode: AP, pricesInclusive: true,
  });
  eqRs('charged tax is authoritative: ₹900', r.totalTaxPaise, 900);
  eqRs('taxable value derived from it: ₹5000', r.taxableValuePaise, 5000);
  eqRs('CGST ₹450', r.cgstPaise, 450);
  eqRs('SGST ₹450', r.sgstPaise, 450);

  // even if the rate table has since changed to 12%, reconstruction is stable
  const later = computeLineTax({
    grossPaise: toPaise(5900), rateBps: 1200, knownTaxPaise: toPaise(900),
    supplierStateCode: AP, placeOfSupplyStateCode: AP,
  });
  eq('a later rate change cannot alter a historical invoice',
    later.totalTaxPaise, r.totalTaxPaise);
}

// ---------------------------------------------------------------------------
section('7. mixed-rate basket — the flower-market normal case');
// ---------------------------------------------------------------------------
{
  const supplier = AP;
  const pos = AP;
  const raw = [
    { desc: 'Fresh red roses (bunch)', hsn: '0603', rateBps: 0, nature: 'nil_rated', gross: toPaise(600), qty: 2 },
    { desc: 'Ceramic planter',          hsn: '6912', rateBps: 1800, nature: 'taxable', gross: toPaise(1180), qty: 1 },
    { desc: 'Gift wrap',                hsn: '4823', rateBps: 1200, nature: 'taxable', gross: toPaise(112), qty: 1 },
  ];
  const lines = raw.map((x) => {
    const t = computeLineTax({
      grossPaise: x.gross, rateBps: x.rateBps, natureOfSupply: x.nature,
      supplierStateCode: supplier, placeOfSupplyStateCode: pos,
    });
    return { ...t, hsnCode: x.hsn, rateBps: x.rateBps, qty: x.qty, grossPaise: x.gross, discountPaise: 0 };
  });

  eqRs('roses: nil-rated value ₹600', lines[0].taxableValuePaise, 600);
  eqRs('planter: taxable ₹1000, tax ₹180', lines[1].taxableValuePaise, 1000);
  eqRs('planter tax ₹180', lines[1].totalTaxPaise, 180);
  eqRs('gift wrap: taxable ₹100, tax ₹12', lines[2].taxableValuePaise, 100);

  const hsn = buildHsnSummary(lines);
  eq('three distinct HSN/rate groups', hsn.length, 3);
  check('nil-rated group is reported separately',
    hsn.some((h) => h.hsnCode === '0603' && h.rateBps === 0 && h.taxableValuePaise === toPaise(600)));

  const totals = summariseInvoice(lines);
  eqRs('invoice taxable value = ₹1700', totals.taxableValuePaise, 1700);
  eqRs('invoice tax = ₹192', totals.totalTaxPaise, 192);
  eqRs('grand total = ₹1892 (already whole rupees)', totals.grandTotalPaise, 1892);
  eq('no round-off needed', totals.roundOffPaise, 0);
  eq('grand total equals what the customer paid',
    totals.grandTotalPaise, lines.reduce((a, l) => a + l.grossPaise, 0));
}

// ---------------------------------------------------------------------------
section('8. invoice round-off (s.170)');
// ---------------------------------------------------------------------------
eq('₹100.49 rounds down (−49 paise)', roundOffPaise(10049), -49);
eq('₹100.50 rounds up (+50 paise)', roundOffPaise(10050), 50);
eq('₹100.51 rounds up (+49 paise)', roundOffPaise(10051), 49);
eq('whole rupees need no adjustment', roundOffPaise(10000), 0);
{
  let bad = 0;
  for (let p = 0; p < 3000; p += 1) {
    const adj = roundOffPaise(p);
    if (Math.abs(adj) > 50) bad += 1;
    if ((p + adj) % 100 !== 0) bad += 1;
  }
  eq('exhaustive: round-off always lands on a whole rupee, |adj| ≤ 50', bad, 0);
}

// ---------------------------------------------------------------------------
section('9. GSTIN validation (format + mod-36 checksum)');
// ---------------------------------------------------------------------------
{
  // build a structurally valid GSTIN and let the checksum function complete it
  const first14 = '37AADCB2230M1Z';
  const cd = computeGstinChecksum(first14.slice(0, 14));
  const valid = `${first14.slice(0, 14)}${cd}`;
  check(`accepts a checksum-valid GSTIN (${valid})`, isValidGstin(valid));
  check('rejects a single-character typo',
    !isValidGstin(`${valid.slice(0, 13)}${valid[13] === 'A' ? 'B' : 'A'}${valid[14]}`));
  check('rejects the wrong length', !isValidGstin('37AADCB2230M1Z'));
  check('rejects a missing Z at position 14', !isValidGstin(`${valid.slice(0, 13)}Y${valid[14]}`));
  check('rejects empty', !isValidGstin(''));
  eq('state code extracted from GSTIN', stateCodeFromGstin(valid), '37');
  eq('PAN extracted from GSTIN', panFromGstin(valid), 'AADCB2230M');
}

// ---------------------------------------------------------------------------
section('10. state resolution from free-text addresses');
// ---------------------------------------------------------------------------
eq('Andhra Pradesh → 37', stateCodeFromName('Andhra Pradesh'), '37');
eq('case and spacing tolerant', stateCodeFromName('  andhra   pradesh '), '37');
eq('Telangana → 36', stateCodeFromName('Telangana'), '36');
eq('alias: Orissa → 21', stateCodeFromName('Orissa'), '21');
eq('alias: New Delhi → 07', stateCodeFromName('New Delhi'), '07');
eq('numeric passthrough', stateCodeFromName('9'), '09');
eq('unknown returns null (never guess the place of supply)', stateCodeFromName('Atlantis'), null);
eq('empty returns null', stateCodeFromName(''), null);

// ---------------------------------------------------------------------------
section('11. financial year labelling');
// ---------------------------------------------------------------------------
eq('1 Apr 2024 → 24-25', fyLabel(new Date('2024-04-01T00:00:00Z')), '24-25');
eq('31 Mar 2025 → 24-25', fyLabel(new Date('2025-03-31T23:59:59Z')), '24-25');
eq('1 Apr 2025 → 25-26', fyLabel(new Date('2025-04-01T00:00:00Z')), '25-26');
eq('2 Sep 2026 → 26-27', fyLabel(new Date('2026-09-02T00:00:00Z')), '26-27');
{
  const r = fyRange(new Date('2026-09-02T00:00:00Z'));
  eq('FY starts 1 Apr 2026', r.from.toISOString().slice(0, 10), '2026-04-01');
  eq('FY ends before 1 Apr 2027', r.to.toISOString().slice(0, 10), '2027-04-01');
}
eq('a calendar-year jurisdiction is configurable', fyLabel(new Date('2024-02-01T00:00:00Z'), 1), '24-25');

// ---------------------------------------------------------------------------
section('12. fuzz — the invoice can never fail to reconcile');
// ---------------------------------------------------------------------------
{
  const rates = [0, 500, 1200, 1800, 2800];
  const natures = ['taxable', 'nil_rated', 'exempt'];
  let mismatches = 0;
  let headMismatches = 0;

  for (let i = 0; i < 20000; i += 1) {
    const gross = 1 + Math.floor(Math.random() * 5_000_00);
    const discount = Math.floor(Math.random() * gross);
    const rateBps = rates[Math.floor(Math.random() * rates.length)];
    const nature = natures[Math.floor(Math.random() * natures.length)];
    const intra = Math.random() < 0.5;
    const r = computeLineTax({
      grossPaise: gross, discountPaise: discount, rateBps, natureOfSupply: nature,
      supplierStateCode: AP, placeOfSupplyStateCode: intra ? AP : KA,
    });
    // taxable + tax must equal the net the customer pays
    if (r.taxableValuePaise + r.totalTaxPaise !== gross - discount) mismatches += 1;
    // heads must sum to the tax
    if (r.cgstPaise + r.sgstPaise + r.igstPaise !== r.totalTaxPaise) headMismatches += 1;
    // heads must be mutually exclusive
    if (r.igstPaise > 0 && (r.cgstPaise > 0 || r.sgstPaise > 0)) headMismatches += 1;
  }
  eq('20 000 random lines: taxable + tax === net charged, always', mismatches, 0);
  eq('20 000 random lines: CGST+SGST+IGST === tax, heads never mixed', headMismatches, 0);
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
console.log(`GST engine: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log('✅ every GST identity holds\n');
