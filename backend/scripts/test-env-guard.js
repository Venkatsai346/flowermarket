/**
 * Test environment guard — MUST be the FIRST import of every DB smoke suite.
 *
 * ESM imports are hoisted and evaluated in source order, so this module runs
 * BEFORE `src/config` (which loads backend/.env via dotenv). Without it the
 * dev .env leaks into test runs: MONGODB_URI would point the suite at the
 * live dev database (mutating it) and DEFAULT_TENANT_ID would resolve to a
 * tenant that does not exist in the in-memory DB (TENANT_NOT_FOUND on every
 * un-headered request).
 *
 * Semantics:
 *  - MONGODB_URI is honored ONLY when explicitly provided on the CLI
 *    (captured here, before dotenv has a chance to set it).
 *  - DEFAULT_TENANT_ID is always cleared so tenant resolution falls back to
 *    the in-memory DB's own bootstrap logic.
 */
const _fmCliMongo = process.env.MONGODB_URI;
process.env.MONGODB_URI = _fmCliMongo || '';
process.env.DEFAULT_TENANT_ID = '';
