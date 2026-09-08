import { writeSync } from 'node:fs';
import config from '../config/index.js';

/**
 * SmsSender — provider abstraction for OTP delivery.
 *
 * Providers (config.otp.provider):
 *   console  -> logs the OTP to the server console (default, perfect for dev)
 *   memory   -> keeps a tiny in-memory map (used by tests / local emulator)
 *   msg91    -> live MSG91 OTP API (Wave 2)
 *   twilio   -> live Twilio Messages API (Wave 2)
 *   ses      -> declared seam; fails loud until wired
 *
 * The rest of the codebase never cares which provider is configured.
 * Production boot refuses console/memory (see assertProductionProviders).
 */
class SmsSender {
  constructor() {
    this._memoryStore = new Map();
  }

  async sendOtp({ channel, target, code, purpose }) {
    const provider = config.otp.provider;

    if (provider === 'console') {
      const label = channel === 'phone' ? 'SMS' : 'EMAIL';
      const line = `[otp:${provider}] ${label} to ${target} | purpose=${purpose} | code=${code}`;
      // writeSync so piped API logs (CI / e2e) see the code before the HTTP
      // response returns — console.log is block-buffered when stdout is not a TTY.
      try { writeSync(1, `${line}\n`); } catch {
        // eslint-disable-next-line no-console
        console.log(line);
      }
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
      if (channel !== 'phone') throw new Error('MSG91 delivers SMS only — use ses for email OTP');
      const authkey = config.otp.msg91AuthKey;
      const templateId = config.otp.msg91TemplateId;
      if (!authkey || !templateId) throw new Error('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required');
      const mobile = String(target).replace(/\D/g, '').slice(-12);
      const res = await fetch('https://control.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: { authkey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ template_id: templateId, mobile, otp: String(code) }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`MSG91 HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
      }
      return { provider, sent: true };
    }

    if (provider === 'twilio') {
      if (channel !== 'phone') throw new Error('Twilio SMS adapter is phone-only');
      const { twilioAccountSid: sid, twilioAuthToken: token, twilioFrom: from } = config.otp;
      if (!sid || !token || !from) {
        throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required');
      }
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const body = new URLSearchParams({
        To: String(target),
        From: from,
        Body: `Your ${config.appName} code is ${code}`,
      });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Twilio HTTP ${res.status}${t ? `: ${t.slice(0, 180)}` : ''}`);
      }
      return { provider, sent: true };
    }

    throw new Error(`SMS provider "${provider}" is not implemented yet`);
  }

  /** Test helper: read the last code sent for (channel, target, purpose). */
  getLastCode({ channel, target, purpose }) {
    return this._memoryStore.get(`${channel}:${target}:${purpose}`) || null;
  }
}

export default new SmsSender();
