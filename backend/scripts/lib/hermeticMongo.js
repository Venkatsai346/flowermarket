/**
 * Shared in-memory MongoDB bootstrap for the hermetic (DB-backed) suites.
 *
 * This module exists because the same three-line bootstrap was copy-pasted into
 * 22 suites and had drifted into two failure modes that both waste an engineer's
 * morning:
 *
 *   1. MASKED ERRORS. Teardown called `await mongod.stop()` unconditionally. When
 *      the failure happened *during* `MongoMemoryServer.create()`, `mongod` was
 *      still undefined, so the catch handler threw a second
 *      `TypeError: Cannot read properties of undefined (reading 'stop')` — and
 *      because that rejection escaped the handler, it was the LAST thing printed.
 *      Any tooling (or human) reading the tail of the log diagnosed the wrong
 *      problem. `stopHermeticMongo()` is null-safe, so the real cause stays the
 *      final word.
 *
 *   2. A VERSION PIN THAT BREAKS ALL AT ONCE. CI pins MONGOMS_VERSION to a
 *      specific mongod build. MongoDB does not ship binaries for every version on
 *      every distro — 6.0.6 has no Debian 12 build at all, and `ubuntu-latest`
 *      images are Debian-derived. When detection resolves to an unmappable
 *      release, EVERY hermetic suite fails simultaneously while the pure suites
 *      still pass, which reads exactly like an infrastructure flake rather than a
 *      pin problem. `createHermeticMongo()` catches that specific error, reads the
 *      minimum version the library itself suggests for this OS, and retries once
 *      with it — so a base-image bump degrades to a warning instead of taking out
 *      the whole matrix.
 *
 * `mongodb-memory-server` is imported lazily so that merely importing this module
 * (which the pure suites' invariant checks now do, to read the sources) never pays
 * for loading it.
 */

/** Version used when the library does not tell us what this OS supports. */
const FALLBACK_VERSION = '7.0.14';

async function loadMongoMemoryServer() {
  const mod = await import('mongodb-memory-server');
  return mod.MongoMemoryServer;
}

/** What the environment asked for, for log messages only. */
function requestedVersion() {
  return process.env.MONGOMS_VERSION || 'the library default';
}

/**
 * Is this the "your pinned version has no binary for this OS" failure, as opposed
 * to a network failure, a permissions failure, or a genuine mongod crash?
 */
export function isVersionIncompatible(err) {
  if (!err) return false;
  if (err.name === 'KnownVersionIncompatibilityError') return true;
  return /is not available for/i.test(String(err.message || ''))
    && /Available Versions/i.test(String(err.message || ''));
}

/**
 * The minimum version the library says this OS supports.
 *
 * The message carries it: `Available Versions: ">=7.0.3"`. Reading it beats
 * hardcoding a second pin — the library already knows the mapping for the distro
 * it detected, and that mapping is what changes when the base image moves.
 */
export function suggestedVersion(err) {
  const m = String(err?.message || '').match(/Available Versions:\s*["']?\s*(?:>=|>)?\s*(\d+\.\d+(?:\.\d+)?)/i);
  return m ? m[1] : null;
}

/** Turn a raw download/distro failure into something an operator can act on. */
function describeFailure(err, attempted) {
  const lines = [
    `Could not start an in-memory mongod (attempted: ${attempted}).`,
    `  Requested version : ${requestedVersion()}`,
    `  Original error    : ${err?.message || err}`,
    '',
    '  This is almost always one of:',
    '    • no network egress to fastdl.mongodb.org (the binary is downloaded on',
    '      first use and cached) — sandboxed and air-gapped runners cannot fetch it;',
    '    • no mongod build for this OS/version pair — MongoDB does not publish',
    '      binaries for every version on every distro;',
    '    • a stale or partially-written binary cache (~/.cache/mongodb-binaries).',
    '',
    '  The PURE suites (invariants, money, state machines, provider adapters,',
    '  production guard, return window, COD ledger) do not need mongod and still',
    '  run — a failure here is not a failure of the application code.',
  ];
  const wrapped = new Error(lines.join('\n'));
  wrapped.cause = err;
  return wrapped;
}

/**
 * Start an in-memory mongod, retrying once on a version/distro mismatch.
 *
 * @param {object} [options] passed through to MongoMemoryServer.create()
 * @returns {Promise<import('mongodb-memory-server').MongoMemoryServer>}
 */
export async function createHermeticMongo(options = {}) {
  const MongoMemoryServer = await loadMongoMemoryServer();

  try {
    return await MongoMemoryServer.create(options);
  } catch (err) {
    if (!isVersionIncompatible(err)) throw describeFailure(err, requestedVersion());

    const suggested = suggestedVersion(err) || FALLBACK_VERSION;
    console.warn(
      `[hermetic-mongo] mongod ${requestedVersion()} has no binary for this OS; `
      + `retrying with ${suggested} (the minimum this distro supports).`
    );

    try {
      return await MongoMemoryServer.create({
        ...options,
        // an explicit binary.version wins over the MONGOMS_VERSION env pin
        binary: { ...(options.binary || {}), version: suggested },
      });
    } catch (retryErr) {
      throw describeFailure(retryErr, `${requestedVersion()}, then ${suggested}`);
    }
  }
}

/**
 * Stop an in-memory mongod without ever throwing.
 *
 * Null-safe on purpose: teardown runs from catch handlers, and a teardown that
 * throws replaces the real diagnostic with its own. Also swallows stop() errors —
 * nothing useful can be done about a mongod that will not shut down, and the
 * process is exiting anyway.
 */
export async function stopHermeticMongo(mongod) {
  if (!mongod) return;
  try {
    await mongod.stop();
  } catch {
    /* teardown is best-effort */
  }
}

/**
 * Fire-and-forget teardown for SYNCHRONOUS contexts.
 *
 * Several suites tear down from `.finally(() => {…})` or `main().catch((err) => {…})`,
 * where `await` is not available. Those sites previously read
 * `if (mongod) mongod.stop().catch(() => {})` — already null-safe, but the guard
 * was hand-written per file and easy to forget. This is the same contract as
 * `stopHermeticMongo` without the await: it starts the shutdown and returns
 * immediately, so the process can exit while it drains.
 *
 * Never throws, for the same reason as its async sibling: teardown must not
 * replace a real diagnostic with its own.
 */
export function stopHermeticMongoSync(mongod) {
  if (!mongod) return;
  try {
    // a floating promise here is deliberate — there is nothing to await in a
    // synchronous teardown, and an error would only mask the real failure
    mongod.stop().catch(() => {});
  } catch {
    /* best effort */
  }
}

export default {
  createHermeticMongo,
  stopHermeticMongo,
  stopHermeticMongoSync,
  isVersionIncompatible,
  suggestedVersion,
};
