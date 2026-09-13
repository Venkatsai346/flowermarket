/**
 * regex.js — user-input → safe RegExp helpers.
 *
 * The single rule that keeps search inputs safe:
 *   NEVER hand raw user input to `new RegExp(...)`.
 *
 * Two failure classes this prevents:
 *   1. CRASH — `?search=(` makes V8 throw SyntaxError at query-build time,
 *      which the error handler cannot map (it is not a Mongo/Joi error) →
 *      a malformed search param returned a 500.
 *   2. DoS — `?search=(a+)+` is a valid regex that backtracks
 *      exponentially; it is compiled here (cheap) but MATCHED BY MONGODB on
 *      every candidate document — a catastrophic pattern stalls a worker.
 *
 * `escapeRegExp` turns the input into a LITERAL substring match: every
 * regex metacharacter is escaped, so the pattern can neither fail to compile
 * nor backtrack. Search semantics become "contains this text", which is what
 * every call site actually wanted (the public catalog path already escaped).
 */

const META_RX = /[.*+?^${}()|[\]\\]/g;

/** Escape every regex metacharacter so the string matches literally. */
export function escapeRegExp(str) {
  return String(str ?? '').replace(META_RX, '\\$&');
}

/** Case-insensitive literal-substring RegExp from user input (never throws). */
export function literalRegex(str, flags = 'i') {
  return new RegExp(escapeRegExp(str), flags);
}

export default escapeRegExp;
