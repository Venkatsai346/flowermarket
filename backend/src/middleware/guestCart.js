/**
 * Guest cart identity — httpOnly cookie + `x-guest-key` header.
 *
 * The cart is a server-side draft. Anonymous visitors get a stable key so
 * add-to-cart works before OTP; on login we merge that draft into the
 * authenticated cart (see cart.service.mergeGuestCart) and clear the cookie.
 *
 * The header exists for tests and for clients that cannot store cookies
 * (the JSON cart payload also echoes `guestKey` so the storefront can keep
 * it in sessionStorage as a belt-and-suspenders).
 */

import crypto from 'node:crypto';
import config from '../config/index.js';

export const GUEST_COOKIE = 'fm_guest';
export const GUEST_HEADER = 'x-guest-key';
export const GUEST_MAX_AGE = 30 * 24 * 60 * 60;

const KEY_RX = /^[A-Za-z0-9_-]{16,64}$/;

export function newGuestKey() {
  return crypto.randomBytes(24).toString('base64url');
}

export function parseCookieHeader(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function parseGuestKey(req) {
  const header = req?.headers?.[GUEST_HEADER] || req?.headers?.['X-Guest-Key'];
  if (header && KEY_RX.test(String(header))) return String(header);
  const cookies = parseCookieHeader(req?.headers?.cookie);
  const c = cookies[GUEST_COOKIE];
  if (c && KEY_RX.test(c)) return c;
  return null;
}

function cookieParts(key, { clear = false } = {}) {
  const parts = [
    `${GUEST_COOKIE}=${clear ? '' : key}`,
    'Path=/',
    `Max-Age=${clear ? 0 : GUEST_MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (config.isProd) parts.push('Secure');
  return parts.join('; ');
}

export function attachGuestCookie(res, key) {
  if (!res || !key) return;
  res.append('Set-Cookie', cookieParts(key));
}

export function clearGuestCookie(res) {
  if (!res) return;
  res.append('Set-Cookie', cookieParts('', { clear: true }));
}

/**
 * Attach `req.guestKey` from cookie/header. Does not mint a key — mutations
 * that need one call `ensureGuestKey`.
 */
export function guestCart(req, _res, next) {
  req.guestKey = parseGuestKey(req);
  next();
}

/** Mint a guest key (and cookie) if the request has neither auth nor a key. */
export function ensureGuestKey(req, res) {
  if (req.auth?.userId) return null;
  if (req.guestKey) return req.guestKey;
  const key = newGuestKey();
  req.guestKey = key;
  attachGuestCookie(res, key);
  return key;
}
