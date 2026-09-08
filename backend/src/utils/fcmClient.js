/**
 * fcmClient.js — Firebase Cloud Messaging HTTP v1, with no Firebase SDK.
 *
 * WHY NOT THE SDK
 * `firebase-admin` pulls in a large transitive tree for what is, in the end, two
 * HTTP calls: exchange a service-account assertion for an access token, then
 * POST a message. This platform already signs RS256 JWTs (jsonwebtoken) and
 * already makes signed HTTP calls (razorpay), so the v1 API is reachable with
 * the existing dependencies — and the whole of it stays auditable.
 *
 * v1 is the only option that still exists: the legacy server key API was shut
 * down in June 2024, so a `serverKey`-shaped config is not a simpler path, it is
 * a dead one.
 *
 * Split like smtpClient.js:
 *   PURE  buildAssertion / buildMessagePayload / isTokenExpired /
 *         classifyError  — asserted in scripts/provider-adapters.test.js
 *   THIN  getAccessToken / sendPush — the two fetches and the token cache
 */

import jwt from 'jsonwebtoken';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Refresh a little early: a token that expires mid-request fails the send. */
const EXPIRY_SKEW_SECONDS = 60;

/**
 * Build the service-account assertion (the JWT that is exchanged for a token).
 *
 * PURE given an injectable clock, so the exact claim set can be asserted.
 * `aud` must be the token endpoint — that is what makes the assertion
 * single-purpose rather than a general credential.
 *
 * @param {object} p
 * @param {string} p.clientEmail   the service account's email
 * @param {string} p.privateKey    PEM; jsonwebtoken accepts the raw string
 * @param {string} [p.scope]
 * @param {number} [p.now]         epoch seconds
 * @param {number} [p.expiresIn]   seconds
 * @returns {string} signed RS256 JWT
 */
export function buildAssertion({ clientEmail, privateKey, scope = SCOPE, now = Math.floor(Date.now() / 1000), expiresIn = 3600 }) {
  if (!clientEmail) throw new TypeError('buildAssertion: client_email is required');
  if (!privateKey) throw new TypeError('buildAssertion: private_key is required');
  // `iat`/`exp` are set as CLAIMS rather than through the `expiresIn` option so
  // the injected clock actually applies — the option path would stamp its own
  // iat and make the assertion non-deterministic under test.
  return jwt.sign(
    { scope, iat: Number(now), exp: Number(now) + Number(expiresIn) },
    privateKey,
    {
      algorithm: 'RS256',
      issuer: clientEmail,
      subject: clientEmail,
      audience: TOKEN_URL,
    },
  );
}

/**
 * Build an FCM v1 message body.
 *
 * v1 splits a message into `notification` (rendered by the OS when the app is
 * backgrounded) and `data` (delivered to the app). Both are sent: an order
 * update must render without the app running, AND carry the order id so a tap
 * deep-links somewhere useful.
 *
 * Data values must be STRINGS in v1 — a number or null is rejected by the API
 * with a 400 that reads like a credential problem, which sends you debugging
 * the wrong thing.
 *
 * @param {object} p
 * @param {string} p.token      device registration token
 * @param {string} p.title
 * @param {string} p.body
 * @param {object} [p.data]     coerced to strings
 * @param {string} [p.image]
 * @returns {object} the `{ message: {...} }` payload v1 expects
 */
export function buildMessagePayload({ token, title, body, data = null, image = null, android = null }) {
  if (!token) throw new TypeError('buildMessagePayload: a device token is required');
  const message = {
    token: String(token),
    notification: { title: String(title ?? ''), body: String(body ?? '') },
  };
  if (image) message.notification.image = String(image);
  if (data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      // skip null/undefined rather than sending the string "null"
      if (v === null || v === undefined) continue;
      out[k] = String(v);
    }
    message.data = out;
  }
  // High priority is what makes an OTP or "rider at the door" push arrive
  // promptly on a Dozing Android device; normal priority can be deferred for
  // hours by the OS, which for a delivery notification is useless.
  message.android = android || { priority: 'high' };
  return { message };
}

/** Is a cached token still usable? */
export function isTokenExpired(expiresAtSeconds, nowSeconds = Math.floor(Date.now() / 1000), skew = EXPIRY_SKEW_SECONDS) {
  if (!expiresAtSeconds) return true;
  return nowSeconds + skew >= Number(expiresAtSeconds);
}

/**
 * Map an FCM error onto what the caller should DO.
 *
 * PURE. The distinction that matters: UNREGISTERED / INVALID_ARGUMENT mean the
 * token is dead and should be pruned from the device table (sending to it again
 * is wasted quota and, worse, hides a real outage in the noise); UNAVAILABLE /
 * INTERNAL mean retry later; SENDER_ID_MISMATCH means the app was built against
 * a different Firebase project, which no retry will fix.
 *
 * @returns {{ retryable: boolean, pruneToken: boolean, code: string, message: string }}
 */
export function classifyError(status, payload) {
  const fcmCode = payload?.error?.details?.[0]?.errorCode
    || payload?.error?.code
    || (payload?.error?.status ? String(payload.error.status) : null)
    || `HTTP_${status}`;
  const code = String(fcmCode).toUpperCase();
  const message = payload?.error?.message || `FCM responded ${status}`;

  const prune = ['UNREGISTERED', 'INVALID_ARGUMENT'].includes(code)
    || /not a valid FCM|unregistered/i.test(message);
  const retryable = status === 429 || status >= 500
    || ['UNAVAILABLE', 'INTERNAL', 'QUOTA_EXCEEDED', 'RATE_LIMITED'].includes(code);
  return { retryable, pruneToken: prune, code, message };
}

/** Parse a Google service-account JSON file into what the client needs. */
export function parseServiceAccount(json) {
  const sa = typeof json === 'string' ? JSON.parse(json) : json;
  const clientEmail = sa?.client_email;
  const privateKey = sa?.private_key;
  const projectId = sa?.project_id;
  if (!clientEmail || !privateKey || !projectId) {
    throw new TypeError('FCM service account JSON must contain client_email, private_key and project_id');
  }
  // Google's JSON files embed the key with literal \n escapes; jwt accepts that,
  // but normalising here means a hand-edited key with real newlines works too.
  return { clientEmail, privateKey: privateKey.replace(/\\n/g, '\n'), projectId };
}

/** The in-process token cache. One entry — there is exactly one service account. */
const cache = { accessToken: null, expiresAt: 0 };

/**
 * Exchange the service-account assertion for an access token (cached).
 *
 * @param {{clientEmail:string, privateKey:string}} sa
 * @param {(url:string, init:object)=>Promise<{ok:boolean,status:number,json:()=>Promise<any>}>} [fetchImpl]
 */
export async function getAccessToken(sa, { fetchImpl = fetch, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!isTokenExpired(cache.expiresAt, now)) return cache.accessToken;
  const assertion = buildAssertion({ clientEmail: sa.clientEmail, privateKey: sa.privateKey });
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`FCM token exchange failed (${res.status}): ${body.error_description || body.error || 'no access_token'}`);
  }
  cache.accessToken = body.access_token;
  cache.expiresAt = now + Number(body.expires_in || 3600);
  return cache.accessToken;
}

/**
 * Send one push. Returns a classified result rather than throwing on a
 * per-device error: the notification worker marks the row and prunes dead
 * tokens, and one bad device must not abort the rest of the batch.
 */
export async function sendPush({ serviceAccount, token, title, body, data = null, image = null, fetchImpl = fetch, now = Math.floor(Date.now() / 1000) }) {
  const sa = serviceAccount.projectId ? serviceAccount : parseServiceAccount(serviceAccount);
  const accessToken = await getAccessToken(sa, { fetchImpl, now });
  const payload = buildMessagePayload({ token, title, body, data, image });
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/messages:send`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, ...classifyError(res.status, json) };
  return { ok: true, ref: json?.name || null, code: 'OK' };
}

/** Drop the cached token (used after a credential rotation or a 401). */
export function clearTokenCache() {
  cache.accessToken = null;
  cache.expiresAt = 0;
}

export default {
  buildAssertion, buildMessagePayload, isTokenExpired, classifyError,
  parseServiceAccount, getAccessToken, sendPush, clearTokenCache, SCOPE, TOKEN_URL,
};
