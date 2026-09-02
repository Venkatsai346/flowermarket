import config from '../config/index.js';

/**
 * SmsSender — provider abstraction for OTP delivery.
 *
 * Providers (config.otp.provider):
 *   console  -> logs the OTP to the server console (default, perfect for dev)
 *   memory   -> keeps a tiny in-memory map (used by tests / local emulator)
 *   msg91 | twilio | ses -> wire real provider SDKs here later
 *
 * The rest of the codebase never cares which provider is configured.
 */
class SmsSender {
  constructor() {
    this._memoryStore = new Map();
  }

  async sendOtp({ channel, target, code, purpose }) {
    const provider = config.otp.provider;

    if (provider === 'console') {
      const label = channel === 'phone' ? 'SMS' : 'EMAIL';
      // eslint-disable-next-line no-console
      console.log(`[otp:${provider}] ${label} to ${target} | purpose=${purpose} | code=${code}`);
      return { provider, sent: true };
    }

    if (provider === 'memory') {
      // test/local-emulator hook: expose the code so flows can be driven headlessly
      this._memoryStore.set(`${channel}:${target}:${purpose}`, code);
      return { provider, sent: true };
    }

    // TODO(phase:notifications): implement msg91 / twilio / SES adapters
    throw new Error(`SMS provider "${provider}" is not implemented yet`);
  }

  /** Test helper: read the last code sent for (channel, target, purpose). */
  getLastCode({ channel, target, purpose }) {
    return this._memoryStore.get(`${channel}:${target}:${purpose}`) || null;
  }
}

export default new SmsSender();
