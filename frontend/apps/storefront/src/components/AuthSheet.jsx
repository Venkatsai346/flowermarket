import { useState } from 'react';
import { KeyRound, Smartphone } from 'lucide-react';
import { api, useShopAuth } from '../api.js';
import { useShop } from '../store.js';
import { Button, Sheet } from './ui.jsx';
import { errMsg } from '../lib/utils.js';

/**
 * Phone + OTP sign-in — the customer flow the backend has supported since
 * Phase 1 and that no client had ever used. Two steps, no password, no email.
 */
export default function AuthSheet() {
  const open = useShop((s) => s.authOpen);
  const close = useShop((s) => s.closeAuth);
  const toast = useShop((s) => s.toast);
  const setSession = useShopAuth((s) => s.setSession);

  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState(null);

  const reset = () => { setStep('phone'); setCode(''); setDevCode(null); };

  const request = async () => {
    if (phone.replace(/\D/g, '').length !== 10) { toast('Enter a 10-digit mobile number', 'error'); return; }
    setBusy(true);
    try {
      const r = await api.shop.requestOtp({ channel: 'sms', target: phone.replace(/\D/g, ''), purpose: 'login' });
      // the console/dev OTP provider echoes the code so the flow is testable
      if (r.data?.code || r.data?.otp) setDevCode(r.data.code || r.data.otp);
      setStep('code');
      toast('Code sent');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const r = await api.shop.verifyOtp({
        channel: 'sms', target: phone.replace(/\D/g, ''), purpose: 'login', code: code.trim(),
      });
      setSession(r.data);
      toast('Signed in', 'success');
      reset();
      close();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => { reset(); close(); }}
      side="bottom"
      title={step === 'phone' ? 'Sign in to continue' : 'Enter the code'}
      subtitle={step === 'phone'
        ? 'We will text you a one-time code — no password needed.'
        : `Sent to +91 ${phone}`}
      footer={(
        <Button
          className="w-full"
          loading={busy}
          icon={step === 'phone' ? Smartphone : KeyRound}
          onClick={step === 'phone' ? request : verify}
        >
          {step === 'phone' ? 'Send code' : 'Verify & continue'}
        </Button>
      )}
    >
      {step === 'phone' ? (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600">Mobile number</span>
          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-medium text-slate-600">+91</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="98765 43210"
              inputMode="numeric"
              autoFocus
              className="input flex-1"
            />
          </div>
        </label>
      ) : (
        <div className="space-y-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••••"
            inputMode="numeric"
            autoFocus
            className="input text-center text-2xl tracking-[0.5em]"
          />
          {devCode && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
              Development mode — your code is <strong className="font-mono">{devCode}</strong>
            </p>
          )}
          <button type="button" onClick={() => setStep('phone')} className="w-full text-center text-xs text-slate-500 underline">
            Change number
          </button>
        </div>
      )}
    </Sheet>
  );
}
