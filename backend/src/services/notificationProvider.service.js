/**
 * NotificationProvider — provider-agnostic channel adapters (Phase 4b).
 *
 * Same pattern as paymentProvider: the rest of the codebase only calls
 * sendPush/sendEmail/sendSms and never depends on which provider is
 * configured. Default provider is `console` (logs + marks sent) so the whole
 * pipeline is testable without real FCM/SMTP credentials.
 *
 * ── ONE PROVIDER PER CHANNEL ────────────────────────────────────────────────
 * `config.notifications.provider` is the default, and each channel can override
 * it (`pushProvider` / `emailProvider` / `smsProvider`). Realistic deployments
 * want different vendors per channel — FCM for push, SMTP for mail, MSG91 for
 * SMS — and a single knob would force one vendor to be good at all three.
 *
 * ── IMPLEMENTED ─────────────────────────────────────────────────────────────
 *   fcm   push  → utils/fcmClient.js (HTTP v1 + service-account OAuth2). The
 *                 legacy server-key API was shut down in June 2024, so v1 is
 *                 not a preference, it is the only path.
 *   smtp  email → utils/smtpClient.js (STARTTLS/implicit TLS, AUTH LOGIN|PLAIN,
 *                 RFC 5322 message with RFC 2047 subjects and dot-stuffing).
 *   msg91/twilio sms → delegated to smsSender, which already implements both
 *                 against the live APIs. Re-implementing them here would mean
 *                 two places to keep credentials and retry semantics right.
 *   apns  push  → still a declared seam. It needs an HTTP/2 client with a TLS
 *                 client certificate; rather than half-implement it, the
 *                 production guard refuses it (see providerCapabilities).
 *
 * Every non-dev provider fails LOUD: a mail or push transport that swallows
 * errors turns "the customer never got their OTP" into a silent support ticket.
 */

import fs from 'node:fs';
import config from '../config/index.js';
import { sendMail } from '../utils/smtpClient.js';
import { sendPush as fcmSend, parseServiceAccount, classifyError } from '../utils/fcmClient.js';
import { isDevOnly } from '../utils/providerCapabilities.js';

/** Resolve the service account once (file path or inline env), then cache it. */
let cachedServiceAccount = null;
function resolveServiceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;
  const f = config.fcm || {};
  if (f.projectId && f.clientEmail && f.privateKey) {
    cachedServiceAccount = { projectId: f.projectId, clientEmail: f.clientEmail, privateKey: f.privateKey };
    return cachedServiceAccount;
  }
  if (f.serviceAccountPath) {
    const raw = fs.readFileSync(f.serviceAccountPath, 'utf8');
    cachedServiceAccount = parseServiceAccount(raw);
    return cachedServiceAccount;
  }
  throw new Error(
    'FCM is configured but no service account was supplied — set FCM_PROJECT_ID + FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY, or FCM_SERVICE_ACCOUNT_PATH',
  );
}

class NotificationProvider {
  /** Which adapter serves a given channel (per-channel override, then default). */
  providerFor(channel) {
    const n = config.notifications || {};
    const override = channel === 'push' ? n.pushProvider : channel === 'email' ? n.emailProvider : n.smsProvider;
    return override || n.provider || 'console';
  }

  async sendPush({ device, title, body, data = {}, notificationId }) {
    const provider = this.providerFor('push');

    if (isDevOnly('notification', provider)) {
      // eslint-disable-next-line no-console
      console.log(`[notif:${provider}] push → ${device.platform}/${device.provider} ${String(device.pushToken).slice(0, 16)}… | ${title} — ${body}`);
      return { ok: true, provider, ref: `mock_push_${notificationId}` };
    }

    if (provider === 'fcm') {
      const result = await fcmSend({
        serviceAccount: resolveServiceAccount(),
        token: device.pushToken,
        title,
        body,
        data: { ...(data || {}), notificationId },
      });
      // A dead token is reported, not thrown: the worker prunes it and moves on
      // to the rest of the batch. One uninstalled app must not stall a dispatch.
      if (!result.ok) {
        return {
          ok: false,
          provider,
          code: result.code,
          message: result.message,
          retryable: result.retryable,
          pruneToken: result.pruneToken,
        };
      }
      return { ok: true, provider, ref: result.ref || `fcm_${notificationId}` };
    }

    if (provider === 'apns') {
      // Declared seam, not implemented: APNs needs HTTP/2 with a TLS client
      // certificate. The production guard refuses this provider, so reaching
      // here means somebody allowed it explicitly.
      throw new Error('APNs adapter is not implemented — use fcm, or set NOTIFICATION_PUSH_PROVIDER=console in development');
    }
    throw new Error(`Push provider "${provider}" is not implemented`);
  }

  async sendEmail({ to, subject, body, html = null, data = {}, notificationId }) {
    const provider = this.providerFor('email');

    if (isDevOnly('notification', provider)) {
      // eslint-disable-next-line no-console
      console.log(`[notif:${provider}] email → ${to} | ${subject}\n${body}`);
      return { ok: true, provider, ref: `mock_email_${notificationId}` };
    }

    if (provider === 'smtp') {
      const smtp = config.smtp || {};
      if (!smtp.host) throw new Error('NOTIFICATION_EMAIL_PROVIDER=smtp but SMTP_HOST is not set');
      const from = smtp.from || config.notifications?.fromEmail;
      if (!from) throw new Error('SMTP_FROM (or NOTIFICATION_FROM_EMAIL) is required to send mail');
      const result = await sendMail({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        user: smtp.user || null,
        pass: smtp.pass || null,
        from,
        to,
        subject,
        // A plain-text fallback is always sent: plenty of mail clients (and
        // every deliverability filter) distrust HTML-only messages.
        text: body,
        html: html || null,
        timeoutMs: smtp.timeoutMs,
        domain: String(from).split('@').pop() || 'localhost',
        headers: notificationId ? { 'X-Notification-Id': String(notificationId) } : {},
      });
      return { ok: true, provider, ref: result.messageId || `smtp_${notificationId}`, recipients: result.recipients };
    }

    throw new Error(`Email provider "${provider}" is not implemented`);
  }

  async sendSms({ to, body, data = {}, notificationId }) {
    const provider = this.providerFor('sms');

    if (isDevOnly('notification', provider)) {
      // eslint-disable-next-line no-console
      console.log(`[notif:${provider}] sms → ${to} | ${body}`);
      return { ok: true, provider, ref: `mock_sms_${notificationId}` };
    }

    if (provider === 'msg91' || provider === 'twilio') {
      // Delegate to smsSender, which already talks to both live APIs and owns
      // their credentials. Two implementations of the same vendor call would be
      // two places to get retries and error handling subtly wrong. The provider
      // is passed explicitly rather than by mutating config, which would race
      // under concurrent sends.
      const { default: smsSender } = await import('./smsSender.service.js');
      const r = await smsSender.sendSms({ to, body, provider });
      return { ok: Boolean(r.sent), provider, ref: `sms_${notificationId}` };
    }

    throw new Error(`SMS provider "${provider}" is not implemented`);
  }
}

export { classifyError };
export default new NotificationProvider();
