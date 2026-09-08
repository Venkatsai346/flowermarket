/**
 * SmsSender — provider abstraction for OTP delivery (and plain SMS).
 *
 * ── TWO SLOTS, BECAUSE ONE VENDOR CANNOT DO BOTH ────────────────────────────
 * `config.otp.provider` serves the PHONE channel; `config.otp.emailProvider`
 * serves EMAIL. They are separate because MSG91 and Twilio are phone-only, and
 * signup sends an EMAIL OTP — so a single knob forced a choice between "no email
 * signup" and "no SMS login". Worse, the combination failed SILENTLY: a
 * production boot on msg91 passed the provider guard and then threw on every
 * signup, because the guard only ever checked the phone slot.
 *
 * `providerForChannel()` is the single place that decision is made, and
 * utils/providerCapabilities.js declares what each adapter can actually serve so
 * the boot guard can verify BOTH slots before listening.
 *
 * Providers:
 *   console  -> logs the code (dev)             phone + email
 *   memory   -> in-process map (tests)          phone + email
 *   msg91    -> live MSG91 OTP API              phone
 *   twilio   -> live Twilio Messages API        phone
 *   smtp     -> utils/smtpClient.js             email
 *   ses      -> declared seam, NOT implemented: the boot guard refuses it, so
 *               it can never again be a production provider that throws on
 *               every login
 *
 * The rest of the codebase never cares which provider is configured.
 */

import config from '../config/index.js';
import { sendMail } from '../utils/smtpClient.js';
import { CHANNEL, providerForChannel, servesChannel, OTP_PROVIDER_CHANNELS } from '../utils/providerCapabilities.js';

/**
 * Send SMS via MSG91. Takes credentials explicitly rather than reading config,
 * so the notification path can use a different vendor slot than OTP without
 * mutating shared state.
 */
async function sendViaMsg91({ to, otp = null, body = null, authkey, templateId }) {
  if (!authkey || !templateId) throw new Error('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required');
  const mobile = String(to).replace(/\D/g, '').slice(-12);
  const payload = { template_id: templateId, mobile };
  // MSG91's OTP endpoint takes the code directly; a plain template SMS goes in
  // as a template variable instead.
  if (otp !== null) payload.otp = String(otp);
  else payload.TPL_VAR = String(body ?? '');
  const res = await fetch('https://control.msg91.com/api/v5/otp', {
    method: 'POST',
    headers: { authkey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MSG91 HTTP ${res.status}${text ? `: ${text.slice(0, 180)}` : ''}`);
  }
  return { sent: true };
}

/** Send SMS via Twilio's Messages API. */
async function sendViaTwilio({ to, body, sid, token, from }) {
  if (!sid || !token || !from) {
    throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required');
  }
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: String(to), From: from, Body: String(body) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Twilio HTTP ${res.status}${text ? `: ${text.slice(0, 180)}` : ''}`);
  }
  return { sent: true };
}

class SmsSender {
  constructor() {
    this._memoryStore = new Map();
  }

  /**
   * Which provider serves this channel?
   *
   * PURE over config — the one place the two-slot decision lives. A provider
   * that cannot serve the channel is a CONFIGURATION bug, and it is reported as
   * such (naming the channel and what the provider does support) rather than
   * surfacing later as a vendor error.
   */
  providerForChannel(channel) {
    return providerForChannel({
      channel,
      phoneProvider: config.otp.provider,
      emailProvider: config.otp.emailProvider,
    });
  }

  /**
   * Send an OTP on the right channel.
   *
   * `channel` decides the provider, never the other way round: an email OTP
   * must not be routed to an SMS vendor just because that is what
   * OTP_PROVIDER says.
   */
  async sendOtp({ channel, target, code, purpose }) {
    const provider = this.providerForChannel(channel);

    if (!servesChannel(provider, channel, OTP_PROVIDER_CHANNELS)) {
      throw new Error(
        `OTP provider "${provider}" cannot deliver on the "${channel}" channel — set `
        + (channel === CHANNEL.EMAIL ? 'OTP_EMAIL_PROVIDER' : 'OTP_PROVIDER')
        + ' to a provider that can',
      );
    }

    if (provider === 'console') {
      const label = channel === CHANNEL.PHONE ? 'SMS' : 'EMAIL';
      // eslint-disable-next-line no-console
      console.log(`[otp:${provider}] ${label} to ${target} | purpose=${purpose} | code=${code}`);
      // dev-only echo so UI flows (storefront OTP sheet) are testable end-to-end;
      // real providers never return the code.
      return { provider, sent: true, code };
    }

    if (provider === 'memory') {
      // test/local-emulator hook: expose the code so flows can be driven headlessly
      this._memoryStore.set(`${channel}:${target}:${purpose}`, code);
      return { provider, sent: true };
    }

    if (provider === 'msg91') {
      const r = await sendViaMsg91({
        to: target, otp: code,
        authkey: config.otp.msg91AuthKey, templateId: config.otp.msg91TemplateId,
      });
      return { provider, ...r };
    }

    if (provider === 'twilio') {
      const r = await sendViaTwilio({
        to: target,
        body: `Your ${config.appName} code is ${code}`,
        sid: config.otp.twilioAccountSid,
        token: config.otp.twilioAuthToken,
        from: config.otp.twilioFrom,
      });
      return { provider, ...r };
    }

    if (provider === 'smtp') {
      const r = await this._sendOtpEmail({ to: target, code, purpose });
      return { provider, ...r };
    }

    // `ses` lands here: a declared seam with no implementation. The production
    // guard refuses it at boot (see providerCapabilities.IMPLEMENTED), so this
    // throw is a development-time signal, never a production outage.
    throw new Error(`OTP provider "${provider}" is not implemented`);
  }

  /**
   * Plain SMS for notifications (order updates, not OTPs).
   *
   * The provider is a PARAMETER, defaulting to the notification slot. This is
   * why it exists separately from sendOtp: the notification vendor may differ
   * from the OTP vendor, and mutating config to switch between them would race
   * under concurrent sends.
   */
  async sendSms({ to, body, provider = config.notifications?.smsProvider || config.otp.provider }) {
    if (provider === 'console' || provider === 'mock') {
      // eslint-disable-next-line no-console
      console.log(`[sms:${provider}] ${to} | ${body}`);
      return { provider, sent: true };
    }
    if (provider === 'msg91') {
      const r = await sendViaMsg91({
        to, body,
        authkey: config.otp.msg91AuthKey, templateId: config.otp.msg91TemplateId,
      });
      return { provider, ...r };
    }
    if (provider === 'twilio') {
      const r = await sendViaTwilio({
        to, body,
        sid: config.otp.twilioAccountSid,
        token: config.otp.twilioAuthToken,
        from: config.otp.twilioFrom,
      });
      return { provider, ...r };
    }
    throw new Error(`SMS provider "${provider}" is not implemented`);
  }

  /** The email half of OTP delivery, over SMTP. */
  async _sendOtpEmail({ to, code, purpose }) {
    const smtp = config.smtp || {};
    if (!smtp.host) throw new Error('OTP_EMAIL_PROVIDER=smtp but SMTP_HOST is not set');
    const from = smtp.from || config.notifications?.fromEmail;
    if (!from) throw new Error('SMTP_FROM (or NOTIFICATION_FROM_EMAIL) is required to send an OTP email');
    const subject = purpose === 'signup'
      ? `Verify your email for ${config.appName}`
      : `Your ${config.appName} verification code`;
    const text = [
      `Your ${config.appName} verification code is ${code}.`,
      '',
      `It expires in ${Math.round((config.otp.ttlSeconds || 300) / 60)} minutes. If you did not request it, you can ignore this email.`,
    ].join('\n');
    // A minimal HTML version: most mail clients render HTML first, and a
    // text-only OTP mail lands in spam folders at a visibly higher rate.
    const html = [
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px">`,
      `<p style="margin:0 0 12px;color:#0f172a;font-size:15px">Your ${config.appName} verification code is</p>`,
      `<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;color:#0f172a">${code}</p>`,
      `<p style="margin:0;color:#64748b;font-size:13px">It expires in ${Math.round((config.otp.ttlSeconds || 300) / 60)} minutes. If you did not request it, you can ignore this email.</p>`,
      `</div>`,
    ].join('');
    const r = await sendMail({
      host: smtp.host, port: smtp.port, secure: smtp.secure,
      user: smtp.user || null, pass: smtp.pass || null,
      from, to, subject, text, html, timeoutMs: smtp.timeoutMs,
      domain: String(from).split('@').pop() || 'localhost',
    });
    return { sent: true, ref: r.messageId };
  }

  /** Test helper: read the last code sent for (channel, target, purpose). */
  getLastCode({ channel, target, purpose }) {
    return this._memoryStore.get(`${channel}:${target}:${purpose}`) || null;
  }
}

export default new SmsSender();
