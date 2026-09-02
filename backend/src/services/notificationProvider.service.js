/**
 * NotificationProvider — provider-agnostic channel adapters (Phase 4b).
 *
 * Same pattern as paymentProvider: the rest of the codebase only calls
 * sendPush/sendEmail/sendSms and never depends on which provider is
 * configured. Default provider is `console` (logs + marks sent) so the whole
 * pipeline is testable without real FCM/APNs/SMTP/Twilio credentials.
 *
 * Real adapters slot in behind these methods (config.notifications.provider):
 *   fcm    -> https://fcm.googleapis.com/v1/projects/{project}/messages:send
 *   apns   -> HTTP/2 POST to api.push.apple.com/3/device/{token}
 *   smtp   -> nodemailer transport
 *   twilio -> Messages API (or reuse SmsSender)
 */

import config from '../config/index.js';

class NotificationProvider {
  async sendPush({ device, title, body, data = {}, notificationId }) {
    const provider = config.notifications.provider;
    if (provider === 'console' || provider === 'mock') {
      // eslint-disable-next-line no-console
      console.log(`[notif:${provider}] push → ${device.platform}/${device.provider} ${device.pushToken.slice(0, 16)}… | ${title} — ${body}`);
      return { ok: true, provider, ref: `mock_push_${notificationId}` };
    }
    if (provider === 'fcm') {
      // FCM HTTP v1 — wire credentials + project id here
      // const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT}/messages:send`, {...});
      throw new Error('FCM adapter: configure credentials before use');
    }
    if (provider === 'apns') {
      // APNs HTTP/2 (node http2) to api.push.apple.com
      throw new Error('APNs adapter: configure credentials before use');
    }
    throw new Error(`Push provider "${provider}" not implemented`);
  }

  async sendEmail({ to, subject, body, data = {}, notificationId }) {
    const provider = config.notifications.provider;
    if (provider === 'console' || provider === 'mock') {
      // eslint-disable-next-line no-console
      console.log(`[notif:${provider}] email → ${to} | ${subject}\n${body}`);
      return { ok: true, provider, ref: `mock_email_${notificationId}` };
    }
    if (provider === 'smtp') {
      // nodemailer transport — wire SMTP_HOST/USER/PASS here
      throw new Error('SMTP adapter: configure credentials before use');
    }
    throw new Error(`Email provider "${provider}" not implemented`);
  }

  async sendSms({ to, body, data = {}, notificationId }) {
    const provider = config.notifications.provider;
    if (provider === 'console' || provider === 'mock') {
      // eslint-disable-next-line no-console
      console.log(`[notif:${provider}] sms → ${to} | ${body}`);
      return { ok: true, provider, ref: `mock_sms_${notificationId}` };
    }
    // real providers (twilio/msg91) slot in here
    throw new Error(`SMS provider "${provider}" not implemented`);
  }
}

export default new NotificationProvider();
