/**
 * providerCapabilities.js — PURE declarations of what each adapter can do.
 *
 * No I/O, no config reads, no imports beyond the enum constants — so
 * `scripts/provider-adapters.test.js` can assert the whole matrix and the
 * production guard can be fed fixtures.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * An adapter seam that is DECLARED but not IMPLEMENTED is worse than a missing
 * one, because it passes every check that looks at names and fails every call
 * that looks at behaviour. Two real examples from this codebase:
 *
 *   • `ses` was in the production guard's allow-list for OTP. A production boot
 *     with OTP_PROVIDER=ses passed the guard, listened, and then threw on every
 *     single login — nobody could authenticate, and the boot log said the
 *     configuration was fine.
 *
 *   • `msg91` and `twilio` are real, working SMS adapters that refuse the email
 *     channel. But signup sends an EMAIL OTP (auth.service, hard-coded), so a
 *     production boot on msg91 passed the guard and then failed every signup.
 *
 * The guard cannot catch either of those by checking provider names. It has to
 * ask two questions: is this adapter actually implemented, and does it serve the
 * channels the application will actually request? That is what this module
 * answers.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A provider appears in `IMPLEMENTED` only when calling it does something real.
 * Adding a name to a live-provider allow-list without an implementation is the
 * exact mistake this module exists to prevent — so `assertImplemented()` is the
 * single gate, and the guard calls it.
 */

/** Delivery channels the application can request. */
export const CHANNEL = Object.freeze({
  PHONE: 'phone',
  EMAIL: 'email',
  PUSH: 'push',
});

/**
 * Which channels each adapter genuinely serves.
 *
 * `console` and `memory` "serve" everything because they are dev/test doubles
 * that never fail — which is precisely why the production guard refuses them
 * separately (`DEV_ONLY`), rather than letting their completeness look like
 * capability.
 */
export const OTP_PROVIDER_CHANNELS = Object.freeze({
  console: [CHANNEL.PHONE, CHANNEL.EMAIL],
  memory: [CHANNEL.PHONE, CHANNEL.EMAIL],
  msg91: [CHANNEL.PHONE],
  twilio: [CHANNEL.PHONE],
  smtp: [CHANNEL.EMAIL],
  ses: [CHANNEL.EMAIL],
});

/**
 * Adapters with a real implementation behind them. Anything NOT in this set is
 * a declared seam that throws when called, and must never be allowed in
 * production no matter how sensible the name looks.
 *
 * `ses` is deliberately absent: the seam exists in config and in the channel
 * matrix, but there is no SES client in the dependency tree, so calling it
 * throws. Listing it here would recreate the original bug. When somebody wires
 * the AWS SDK, the one-line change is to add it HERE — and the guard, the
 * capability check and the docs all follow.
 */
export const IMPLEMENTED = Object.freeze({
  otp: new Set(['console', 'memory', 'msg91', 'twilio', 'smtp']),
  /**
   * `msg91` and `twilio` are here because the notification SMS path delegates
   * to smsSender, which really does call their live APIs. Omitting them would
   * make the boot guard refuse a working configuration — the mirror image of
   * the `ses` mistake, and exactly what the "every name in the matrix is
   * accounted for" invariant exists to catch.
   */
  notification: new Set(['console', 'mock', 'smtp', 'fcm', 'msg91', 'twilio']),
  /**
   * Both storage drivers are real. `local` is nevertheless refused in
   * production by the guard — not because it is missing, but because it writes
   * to one pod's filesystem, so media uploaded to a second replica is invisible
   * to the first and everything is lost on redeploy. "Implemented" and "safe to
   * run in production" are different questions and the guard asks both.
   */
  storage: new Set(['local', 's3']),
  /**
   * `mongo` is the ranked Mongo index and is genuinely production-grade.
   * `atlas` and `opensearch` are DECLARED SEAMS: searchProvider builds a
   * NotImplemented class for them whose every method throws. Allowing either in
   * production would mean search returns 500s on the first query — the same
   * trap `ses` set for OTP.
   */
  search: new Set(['mongo']),
});

/** Dev/test doubles: they work, but never against real customers. */
export const DEV_ONLY = Object.freeze({
  otp: new Set(['console', 'memory']),
  notification: new Set(['console', 'mock']),
  storage: new Set(['local']),
  search: new Set([]),
});

/**
 * Known-but-unimplemented seams, per subsystem. The guard names these
 * specifically: "declared but not implemented" is a different mistake from
 * "you typed a nonsense value", and the fix is different too.
 */
export const DECLARED_NOT_IMPLEMENTED = Object.freeze({
  otp: new Set(['ses']),
  notification: new Set(['apns']),
  storage: new Set([]),
  search: new Set(['atlas', 'opensearch']),
});

/** Channels each NOTIFICATION provider serves (a provider can do several). */
export const NOTIFICATION_PROVIDER_CHANNELS = Object.freeze({
  console: [CHANNEL.PUSH, CHANNEL.EMAIL, CHANNEL.PHONE],
  mock: [CHANNEL.PUSH, CHANNEL.EMAIL, CHANNEL.PHONE],
  smtp: [CHANNEL.EMAIL],
  fcm: [CHANNEL.PUSH],
  apns: [CHANNEL.PUSH],
  twilio: [CHANNEL.PHONE],
  msg91: [CHANNEL.PHONE],
});

/** The channels the application actually requests at runtime. */
export const REQUIRED_OTP_CHANNELS = Object.freeze([CHANNEL.PHONE, CHANNEL.EMAIL]);
export const REQUIRED_NOTIFICATION_CHANNELS = Object.freeze([CHANNEL.PUSH, CHANNEL.EMAIL, CHANNEL.PHONE]);

/** Which channels a provider serves (empty array for an unknown name). */
export function channelsServedBy(provider, table = OTP_PROVIDER_CHANNELS) {
  return table[String(provider || '')] || [];
}

/** Does this provider serve this channel? */
export function servesChannel(provider, channel, table = OTP_PROVIDER_CHANNELS) {
  return channelsServedBy(provider, table).includes(channel);
}

/** Is there a real implementation behind this name? */
export function isImplemented(kind, provider) {
  return Boolean(IMPLEMENTED[kind]?.has(String(provider || '')));
}

/** Is this a dev/test double that must not face customers? */
export function isDevOnly(kind, provider) {
  return Boolean(DEV_ONLY[kind]?.has(String(provider || '')));
}

/** Is this a name that exists in config/docs but has no working adapter? */
export function isDeclaredNotImplemented(kind, provider) {
  return Boolean(DECLARED_NOT_IMPLEMENTED[kind]?.has(String(provider || '')));
}

/** Is this name known to the subsystem at all? */
export function isKnown(kind, provider, table = null) {
  const name = String(provider || '');
  if (table) return Boolean(table[name]);
  return Boolean(
    IMPLEMENTED[kind]?.has(name)
    || DEV_ONLY[kind]?.has(name)
    || DECLARED_NOT_IMPLEMENTED[kind]?.has(name),
  );
}

/**
 * Which required channels does this provider leave uncovered?
 *
 * PURE and deliberately returns a LIST rather than a boolean: the guard prints
 * the channels by name, because "msg91 cannot serve email" is actionable and
 * "provider check failed" is not.
 */
export function missingChannels(provider, required, table = OTP_PROVIDER_CHANNELS) {
  const served = channelsServedBy(provider, table);
  return required.filter((c) => !served.includes(c));
}

/**
 * One adapter per channel: which provider should serve `channel`?
 *
 * The platform runs TWO OTP slots on purpose — in India the realistic setup is
 * MSG91 for SMS and SES/SMTP for email, and very few vendors do both well. A
 * single `OTP_PROVIDER` therefore forces a choice between "no email signup" and
 * "no SMS login", which is how the original bug stayed invisible.
 */
export function providerForChannel({ channel, phoneProvider, emailProvider }, table = OTP_PROVIDER_CHANNELS) {
  return channel === CHANNEL.EMAIL ? emailProvider : phoneProvider;
}

/**
 * Full verdict for a (provider, channel) pair — what the guard reports.
 * @returns {{ ok: boolean, reason?: string, provider: string, channel: string }}
 */
export function checkChannelSupport({ provider, channel, kind = 'otp' }) {
  const table = kind === 'notification' ? NOTIFICATION_PROVIDER_CHANNELS : OTP_PROVIDER_CHANNELS;
  const name = String(provider || '');
  if (!table[name]) {
    return { ok: false, provider: name, channel, reason: `unknown ${kind} provider "${name || '(unset)'}"` };
  }
  if (!isImplemented(kind, name)) {
    return {
      ok: false,
      provider: name,
      channel,
      reason: `${kind} provider "${name}" is a declared seam with no implementation — it would throw on every send`,
    };
  }
  if (!servesChannel(name, channel, table)) {
    return {
      ok: false,
      provider: name,
      channel,
      reason: `${kind} provider "${name}" does not serve the "${channel}" channel (it serves: ${channelsServedBy(name, table).join(', ') || 'nothing'})`,
    };
  }
  return { ok: true, provider: name, channel };
}

export default {
  CHANNEL,
  DECLARED_NOT_IMPLEMENTED,
  OTP_PROVIDER_CHANNELS,
  NOTIFICATION_PROVIDER_CHANNELS,
  IMPLEMENTED,
  DEV_ONLY,
  REQUIRED_OTP_CHANNELS,
  REQUIRED_NOTIFICATION_CHANNELS,
  channelsServedBy,
  servesChannel,
  isImplemented,
  isDevOnly,
  isDeclaredNotImplemented,
  isKnown,
  missingChannels,
  providerForChannel,
  checkChannelSupport,
};
