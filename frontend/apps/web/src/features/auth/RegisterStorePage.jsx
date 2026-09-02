import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Flower2, ShoppingBag, Sparkles } from 'lucide-react';
import { bpsToPct, inr, inr0, useAuthStore } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Button from '../../components/ui/Button.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export default function RegisterStorePage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const { data: plansData, loading } = useApi(() => api.marketplace.plans());
  const plans = plansData ?? []; // Nullish coalescing guarantees an array

  const [form, setForm] = useState({
    name: '',
    slug: '',
    slugTouched: false,
    contactEmail: '',
    plan: 'pro',
    firstName: '',
    lastName: '',
    ownerEmail: '',
    password: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onName = (name) => {
    set('name', name);
    if (!form.slugTouched) set('slug', slugify(name));
  };

  const selectedPlan = useMemo(
    () => plans.find((p) => p.code === form.plan) || plans[0],
    [plans, form.plan]
  );

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.marketplace.registerStore({
        name: form.name,
        slug: form.slug,
        plan: form.plan,
        contactEmail: form.contactEmail,
        owner: {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.ownerEmail,
          password: form.password,
        },
      });
      setSession(r.data);
      toast.success(`Store “${form.name}” created — you're the owner! 🎉`);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-slate-50 to-slate-100 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-600 text-white shadow-lg shadow-rose-600/25">
            <Flower2 className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Open your store on the marketplace</h1>
            <p className="text-sm text-slate-500">
              Pick a plan, claim your slug, and get a store-owner account in seconds.
            </p>
          </div>
        </div>

        {loading ? (
          <LoadingBlock />
        ) : (
          <form onSubmit={submit} className="space-y-6">
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>
            )}

            {/* plan picker */}
            <div>
              <p className="label">Choose a plan</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {plans.map((p) => (
                  <button
                    type="button"
                    key={p.code}
                    onClick={() => set('plan', p.code)}
                    className={cn(
                      'relative rounded-2xl border-2 bg-white p-4 text-left transition',
                      form.plan === p.code
                        ? 'border-rose-500 shadow-md ring-2 ring-rose-500/20'
                        : 'border-slate-200 hover:border-slate-300'
                    )}
                  >
                    {p.code === 'pro' && (
                      <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        <Sparkles className="h-3 w-3" /> POPULAR
                      </span>
                    )}
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-900">{p.name}</p>
                      <BadgeCheck className={cn('h-4 w-4', form.plan === p.code ? 'text-rose-600' : 'text-slate-300')} />
                    </div>
                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {inr0(p.priceMonthly)}
                      <span className="text-xs font-medium text-slate-400">/mo</span>
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {p.commissionRateBps ? `${bpsToPct(p.commissionRateBps)} commission` : 'No commission'} ·
                      {p.trialDays ? ` ${p.trialDays}d trial` : ' paid from day 1'}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {p.features?.marketplaceEnabled ? 'Marketplace mode ✓' : 'Single-brand store'}
                    </p>
                  </button>
                ))}
              </div>
              {selectedPlan?.description && (
                <p className="mt-2 text-xs text-slate-500">{selectedPlan.description}</p>
              )}
            </div>

            {/* store identity */}
            <div className="card card-pad space-y-4">
              <p className="text-sm font-semibold text-slate-800">Store identity</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Store name" required>
                  <Input required value={form.name} onChange={(e) => onName(e.target.value)} placeholder="Vizag Fresh Flowers" />
                </Field>
                <Field label="Store URL slug" required hint={`your-store will live at /stores/${form.slug || '…'}`}>
                  <Input required value={form.slug} onChange={(e) => { set('slugTouched', true); set('slug', slugify(e.target.value)); }} placeholder="vizag-fresh-flowers" />
                </Field>
              </div>
              <Field label="Contact email (public)">
                <Input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="hello@vizagflowers.in" />
              </Field>
            </div>

            {/* owner */}
            <div className="card card-pad space-y-4">
              <p className="text-sm font-semibold text-slate-800">Store owner account</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" required>
                  <Input required value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="Srinivas" />
                </Field>
                <Field label="Last name" required>
                  <Input required value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="Rao" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" required hint="Used to sign in">
                  <Input type="email" required value={form.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} placeholder="owner@vizagflowers.in" />
                </Field>
                <Field label="Password" required hint="Min 8 characters">
                  <Input type="password" required minLength={8} value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="••••••••" />
                </Field>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <ShoppingBag className="h-4 w-4" /> You'll be signed in as the store owner immediately.
              </p>
              <Button type="submit" loading={busy} icon={Flower2}>
                Create my store
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
