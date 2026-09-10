/**
 * transactions — multi-document transaction support probe.
 *
 * MongoDB transactions need a replica set (or mongos). Production runs one;
 * local dev and the hermetic suites run a standalone mongod, where starting a
 * transaction throws `Transaction numbers are only allowed on a replica set
 * member or mongos`. Callers use this probe to pick the atomicity strategy:
 * a real transaction when supported, ordered writes + compensating cleanup
 * when not. Either way the operation is all-or-nothing from the outside.
 *
 * The answer is cached per process: topology never changes under a running
 * server, and every call site runs on the hot path (registration).
 */
import mongoose from 'mongoose';

let cached = null;

export async function transactionsSupported() {
  if (cached !== null) return cached;
  try {
    const admin = mongoose.connection?.db?.admin();
    const hello = admin ? await admin.command({ hello: 1 }) : null;
    cached = Boolean(hello && (hello.setName || hello.msg === 'isdbgrid'));
  } catch {
    // Fail SAFE: an unreachable/unready connection must not take the
    // transaction path (it would throw); the compensation path degrades
    // gracefully and surfaces the real connection error instead.
    cached = false;
  }
  return cached;
}

export default { transactionsSupported };
