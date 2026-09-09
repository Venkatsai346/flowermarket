/**
 * Stryker mutation testing configuration.
 *
 * Mutation testing validates that your TESTS are good enough to catch bugs.
 * Stryker introduces small changes (mutations) to the source code and checks
 * if any test fails. If no test fails, the mutation "survived" — meaning
 * there's a gap in test coverage.
 *
 * Run: npx stryker run tests/mutation/stryker.config.mjs
 *
 * Focus areas:
 *   - Money calculations (toPaise, allocatePaise, splitTaxPaise)
 *   - Tax engine (place of supply, rate resolution)
 *   - Inventory operations (reserve, release, commit)
 *   - Order state machine
 *   - Authentication logic
 */

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'command',
  commandRunner: {
    command: 'cd ../../backend && node scripts/money.test.js && node scripts/tax-calc.test.js',
  },
  coverageAnalysis: 'off',
  thresholds: {
    high: 80,
    low: 60,
    break: 50, // CI fails if mutation score drops below 50%
  },
  mutate: [
    '../../backend/src/utils/money.js',
    '../../backend/src/utils/tax.js',
    '../../backend/src/services/inventory.service.js',
    '../../backend/src/services/order.service.js',
    '../../backend/src/services/payment.service.js',
    '../../backend/src/services/refund.service.js',
    '../../backend/src/services/refundCalculator.service.js',
  ],
  // Skip patterns that are hard to test or not worth mutating
  mutator: {
    excludedMutations: [
      'StringLiteral',    // string mutations add noise
      'ArrayDeclaration', // array init mutations are rarely meaningful
    ],
  },
  // Timeout per mutant (the money tests are fast)
  timeoutMS: 30000,
  concurrency: 4,
  // HTML report for reviewing survived mutants
  htmlReporter: {
    fileName: 'tests/mutation/reports/mutation-report.html',
  },
};

export default config;
