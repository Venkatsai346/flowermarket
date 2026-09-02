import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Flower2, HelpCircle, Lock, Mail } from 'lucide-react';
import { useAuthStore } from '@flower-market/shared';
import { api, setLoginTenantId } from '../../api.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Button from '../../components/ui/Button.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';

const homeFor = (role) =>
  role === 'super_admin' ? '/platform' : role === 'admin' ? '/' : role === 'vendor' ? '/vendor' : '/no-access';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState(() => useAuthStore.getState().lastTenantId || '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    // scope the login lookup to a non-default tenant when provided (store owners)
    setLoginTenantId(tenantId);
    try {
      const r = await api.auth.login({ email, password });
      setSession(r.data);
      toast.success(`Welcome back${r.data.user?.profile?.firstName ? ', ' + r.data.user.profile.firstName : ''}!`);
      const from = location.state?.from;
      navigate(from && from !== '/login' ? from : homeFor(r.data.user?.role), { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoginTenantId('');
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-rose-50 via-slate-50 to-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-rose-600 text-white shadow-lg shadow-rose-600/25">
            <Flower2 className="h-7 w-7" />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Flower Market Console</h1>
          <p className="mt-1 text-sm text-slate-500">
            Platform, store &amp; vendor operations — one console.
          </p>
        </div>

        <form onSubmit={submit} className="card card-pad space-y-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              {error}
            </div>
          )}
          <Field label="Email">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="email"
                required
                autoComplete="email"
                placeholder="admin@flowermarket.in"
                className="pl-9!"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </Field>
          <Field
            label="Tenant id (optional)"
            hint="For store-owner logins — your store's id, shown in the console topbar."
          >
            <Input
              type="text"
              autoComplete="off"
              placeholder="6a96f449… (platform admin: leave empty)"
              className="font-mono text-xs"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="pl-9!"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </Field>
          <Button type="submit" loading={busy} className="w-full">
            Sign in
          </Button>

          <details className="group rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-slate-600">
              <HelpCircle className="h-3.5 w-3.5" /> Demo credentials
            </summary>
            <div className="mt-2 space-y-1 font-mono">
              <p>Platform admin: <b>admin@flowermarket.in</b> / <b>Admin@12345</b></p>
              <p>Tip: register a new store to get a store-owner login.</p>
            </div>
          </details>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          New here?{' '}
          <Link to="/register" className="font-semibold text-rose-600 hover:text-rose-700">
            Open your store
          </Link>
        </p>
      </div>
    </div>
  );
}
