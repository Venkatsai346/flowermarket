import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Lock, Mail } from 'lucide-react';
import { api } from '../../api.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Button from '../../components/ui/Button.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';

/**
 * Forgot-password: email → OTP → new password (no login required).
 *
 * Email targets resolve GLOBALLY on the server (the same rule that fixes
 * login), so a store owner resets from the console without knowing any tenant
 * id. Two server details shape the UX: `expiresInSeconds` (say when the code
 * dies) and the 429 `details.retryAfterSeconds` cooldown (count it down rather
 * than inviting another tap into another 429). `devCode` renders only when the
 * server echoes it — impossible in production, but it saves every laptop env
 * (where no email is ever delivered) from an uncompletable flow.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [expiresIn, setExpiresIn] = useState(null);
  const [devCode, setDevCode] = useState(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldownLeft <= 0) return undefined;
    const t = setInterval(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldownLeft]);

  const request = async (e) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.auth.requestPasswordReset({ purpose: 'password_reset', channel: 'email', email: email.trim() });
      setExpiresIn(typeof r.data?.expiresInSeconds === 'number' ? r.data.expiresInSeconds : null);
      setDevCode(r.data?.devCode || null);
      setSent(true);
      setCooldownLeft(0);
      toast.success(`Reset code sent to ${email.trim()}`);
    } catch (err) {
      const wait = err?.details?.retryAfterSeconds;
      if (err?.code === 'OTP_RESEND_COOLDOWN' && typeof wait === 'number') setCooldownLeft(wait);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await api.auth.resetPassword({ channel: 'email', email: email.trim(), otpCode: code.trim(), newPassword: password });
      toast.success('Password updated — sign in with your new password');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const expiryMins = expiresIn != null ? Math.max(1, Math.round(expiresIn / 60)) : null;

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-rose-50 via-slate-50 to-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-rose-600 text-white shadow-lg shadow-rose-600/25">
            <KeyRound className="h-7 w-7" />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Reset your password</h1>
          <p className="mt-1 text-sm text-slate-500">
            {sent ? 'Enter the code we emailed and choose a new password.' : 'We will email you a one-time code.'}
          </p>
        </div>

        <form onSubmit={sent ? reset : request} className="card card-pad space-y-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>
          )}

          <Field label="Email">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="email"
                required
                autoComplete="email"
                disabled={sent}
                placeholder="owner@yourstore.in"
                className="pl-9!"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </Field>

          {!sent ? (
            <>
              <Button type="submit" loading={busy} disabled={cooldownLeft > 0} className="w-full">
                {cooldownLeft > 0 ? `Resend in ${cooldownLeft}s` : 'Send reset code'}
              </Button>
              <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Link>
            </>
          ) : (
            <>
              <Field label="Code" hint={expiryMins != null ? `Expires in ~${expiryMins} min` : undefined}>
                <Input
                  required
                  autoFocus
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="••••••"
                  className="text-center font-mono tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              {devCode && (
                <p className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-2 py-1 font-mono text-[11px] font-bold tracking-widest text-amber-800">
                  Dev code: {devCode}
                </p>
              )}
              <Field label="New password" hint="Min 6 characters">
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="pl-9!"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </Field>
              <Field label="Confirm password">
                <Input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              <Button type="submit" loading={busy} className="w-full">
                Reset password
              </Button>
              <button
                type="button"
                disabled={busy || cooldownLeft > 0}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={request}
              >
                {cooldownLeft > 0 ? `Resend in ${cooldownLeft}s` : 'Resend code'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
