import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAction } from '../../lib/useApi.js';
import { toast } from '../../lib/toasts.js';
import Button from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import { errMsg } from '../../lib/utils.js';

/**
 * Inline code-entry for the ownerEmail gap: request → type the code → done.
 *
 * Mounted both in the dashboard checklist and in any STORE_NOT_READY panel
 * (e.g. the Storefront page), because the fix for an unverified email must be
 * wherever the merchant learns about it — not one undiscoverable page.
 *
 * Two server details shape the UX: `expiresInSeconds` (say when the code dies)
 * and 429 `details.retryAfterSeconds` (count the resend cooldown down instead
 * of inviting another tap into another 429). `devCode` is rendered ONLY when
 * the server sends it — the console provider echoes it, which production boot
 * refuses, so this box is impossible in production but saves every laptop env
 * (where no email is ever actually delivered) from an uncompletable flow.
 */
export default function VerifyEmailAction({ onVerified }) {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [expiresIn, setExpiresIn] = useState(null);
  const [devCode, setDevCode] = useState(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const { busy, run } = useAction();

  useEffect(() => {
    if (cooldownLeft <= 0) return undefined;
    const t = setInterval(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldownLeft]);

  const request = async () => {
    try {
      const r = await run(() => api.marketplace.requestEmailVerify());
      if (r.data?.alreadyVerified) {
        toast.success('Owner email already verified');
        onVerified?.();
        return;
      }
      setEmail(r.data?.email || '');
      setExpiresIn(typeof r.data?.expiresInSeconds === 'number' ? r.data.expiresInSeconds : null);
      setDevCode(r.data?.devCode || null);
      setSent(true);
      setCooldownLeft(0);
      toast.success(`Code sent${r.data?.email ? ` to ${r.data.email}` : ''}`);
    } catch (e) {
      const wait = e?.details?.retryAfterSeconds;
      if (e?.code === 'OTP_RESEND_COOLDOWN' && typeof wait === 'number') {
        setCooldownLeft(wait);
      }
      toast.error(errMsg(e));
    }
  };

  const confirm = async () => {
    if (!code.trim()) return;
    try {
      await run(() => api.marketplace.confirmEmailVerify(code.trim()));
      toast.success('Owner email verified');
      onVerified?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!sent) {
    return (
      <Button variant="secondary" size="sm" loading={busy} onClick={request}>
        Send code
      </Button>
    );
  }
  const expiryMins = expiresIn != null ? Math.max(1, Math.round(expiresIn / 60)) : null;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          className="w-28! text-center font-mono tracking-widest"
          placeholder="••••••"
          value={code}
          maxLength={10}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}
          aria-label={`Verification code sent to ${email}`}
        />
        <Button size="sm" loading={busy} disabled={!code.trim()} onClick={confirm}>
          Verify
        </Button>
        <button
          type="button"
          disabled={busy || cooldownLeft > 0}
          className="text-xs font-semibold text-slate-400 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={request}
        >
          {cooldownLeft > 0 ? `Resend in ${cooldownLeft}s` : 'Resend'}
        </button>
      </div>
      {expiryMins != null && (
        <p className="text-[11px] text-slate-400">Code expires in ~{expiryMins} min</p>
      )}
      {devCode && (
        <p className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-2 py-1 font-mono text-[11px] font-bold tracking-widest text-amber-800">
          Dev code: {devCode}
        </p>
      )}
    </div>
  );
}
