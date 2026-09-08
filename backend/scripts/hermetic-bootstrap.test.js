/**
 * hermetic-bootstrap.test.js — pure checks on scripts/lib/hermeticMongo.js.
 *
 *   node scripts/hermetic-bootstrap.test.js
 *
 * The DB-backed suites themselves cannot run without a downloadable mongod
 * binary, but the logic that decides WHETHER to retry, WITH WHAT version, and
 * how teardown behaves when there is nothing to tear down is pure and testable.
 * That logic is exactly what F10 was about: a masked error and a version pin
 * that could take out all 22 suites at once.
 *
 * No database, no network, no binary download.
 */

import assert from 'node:assert/strict';
import {
  isVersionIncompatible,
  suggestedVersion,
  stopHermeticMongo,
  stopHermeticMongoSync,
} from './lib/hermeticMongo.js';

let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };

// The verbatim error mongodb-memory-server raises on Debian 12 with the 6.0.6
// pin CI uses. Testing against the real text is the point — a regex tuned to a
// paraphrase would pass here and fail in CI.
const DEBIAN_12 = new Error(
  'Requested Version "6.0.6" is not available for "Debian 12"!\n'
  + 'Available Versions: ">=7.0.3"\n'
  + 'Mongodb does not provide binaries for versions before 7.0.3 for Debian 12+\n'
  + 'and also cannot be mapped to a previous Debian release'
);
DEBIAN_12.name = 'KnownVersionIncompatibilityError';

console.log('\n── version/distro detection ─────────────────────────────');
{
  assert.equal(isVersionIncompatible(DEBIAN_12), true);
  assert.equal(suggestedVersion(DEBIAN_12), '7.0.3');
  ok('the real Debian-12 failure is recognised, and yields 7.0.3');

  // Detected by name alone, in case the wording changes.
  const byName = new Error('something else entirely');
  byName.name = 'KnownVersionIncompatibilityError';
  assert.equal(isVersionIncompatible(byName), true);
  ok('the error NAME alone is enough to recognise it (wording may change)');

  // The unquoted form also appears in some versions.
  const bare = new Error('Requested Version "5.0.0" is not available for "Ubuntu 24"! Available Versions: >=8.0.1');
  assert.equal(isVersionIncompatible(bare), true);
  assert.equal(suggestedVersion(bare), '8.0.1');
  ok('an unquoted "Available Versions: >=8.0.1" is parsed too');

  const twoPart = new Error('not available for "Alpine"! Available Versions: ">=7.0"');
  assert.equal(suggestedVersion(twoPart), '7.0');
  ok('a two-part version (7.0) is accepted');
}

console.log('\n── what must NOT be retried ─────────────────────────────');
{
  // The single most important negative case. The sandbox failure observed while
  // writing this was a network ECONNRESET to fastdl.mongodb.org. Retrying that
  // would download nothing, waste a minute, and bury the real diagnosis under a
  // second identical error.
  const network = new Error('connect ECONNRESET 34.102.100.49:443');
  assert.equal(isVersionIncompatible(network), false);
  assert.equal(suggestedVersion(network), null);
  ok('a network failure is NOT treated as a version problem (a retry cannot fix it)');

  const crashed = new Error('mongod failed to start: exit code 48, address already in use');
  assert.equal(isVersionIncompatible(crashed), false);
  ok('a mongod that crashes on startup is not a version problem');

  // Both halves of the message are required, so an unrelated "is not available
  // for" string cannot trigger a pointless retry.
  const lookalike = new Error('feature X is not available for this build');
  assert.equal(isVersionIncompatible(lookalike), false);
  ok('a lookalike message without "Available Versions" does not trigger a retry');

  assert.equal(isVersionIncompatible(undefined), false);
  assert.equal(isVersionIncompatible(null), false);
  assert.equal(isVersionIncompatible(new Error('')), false);
  assert.equal(suggestedVersion(undefined), null);
  ok('undefined / null / empty errors are handled without throwing');

  // A recognised incompatibility whose message omits the hint must still get a
  // usable version rather than undefined.
  const noHint = new Error('Requested Version "4.4.0" is not available for "Debian 12"! Available Versions: unknown');
  assert.equal(isVersionIncompatible(noHint), true);
  assert.equal(suggestedVersion(noHint), null, 'returns null so the caller applies its own fallback');
  ok('a recognised failure with no parseable hint returns null, deferring to the fallback');
}

console.log('\n── teardown is null-safe and never throws ───────────────');
{
  // The original F10 bug: teardown ran from a catch handler while `mongod` was
  // still undefined, because the failure happened during create(). The resulting
  // TypeError escaped the handler and became the last line of the log.
  await assert.doesNotReject(() => stopHermeticMongo(undefined));
  await assert.doesNotReject(() => stopHermeticMongo(null));
  ok('stopHermeticMongo(undefined) resolves instead of throwing a TypeError');

  assert.doesNotThrow(() => stopHermeticMongoSync(undefined));
  assert.doesNotThrow(() => stopHermeticMongoSync(null));
  ok('stopHermeticMongoSync(undefined) is equally safe');

  // A mongod that refuses to stop must not mask the failure being torn down.
  const throwing = { stop: async () => { throw new Error('already shut down'); } };
  await assert.doesNotReject(() => stopHermeticMongo(throwing));
  ok('an async stop() that rejects is swallowed');

  const syncThrowing = { stop: () => { throw new Error('socket closed'); } };
  assert.doesNotThrow(() => stopHermeticMongoSync(syncThrowing));
  ok('a synchronous stop() that throws is swallowed');

  const rejecting = { stop: () => Promise.reject(new Error('nope')) };
  assert.doesNotThrow(() => stopHermeticMongoSync(rejecting));
  // let the floating rejection settle so it cannot surface as an unhandled one
  await new Promise((r) => setImmediate(r));
  ok('the sync variant attaches a catch, so no unhandled rejection escapes');

  let stopped = false;
  await stopHermeticMongo({ stop: async () => { stopped = true; } });
  assert.equal(stopped, true);
  ok('a real instance is genuinely stopped (the guard is not a no-op)');

  let syncStopped = false;
  stopHermeticMongoSync({ stop: () => { syncStopped = true; return Promise.resolve(); } });
  assert.equal(syncStopped, true);
  ok('the sync variant really does fire stop() before the process exits');
}

console.log(`\nHERMETIC BOOTSTRAP: all ${pass} scenarios passed ✔\n`);
