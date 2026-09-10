import { useEffect, useState } from 'react';
import { BadgeCheck, Clock3, Flower2, RotateCcw, Store } from 'lucide-react';
import { api, useShopAuth } from '../api.js';
import { useShop } from '../store.js';
import { Button, Empty, Skeleton } from '../components/ui.jsx';

/**
 * /sell — become a vendor on this marketplace.
 *
 * Anyone signed in can apply; the platform team reviews every application and
 * the `vendor` role is granted ONLY on approval. Applicants can watch their
 * status here, see the reviewer's note, and re-apply after a rejection.
 */

const STATUS_META = {
  submitted: { icon: Clock3, title: 'Application received', tone: 'text-amber-600', chip: 'bg-amber-100 text-amber-800' },
  under_review: { icon: Clock3, title: 'Under review', tone: 'text-amber-600', chip: 'bg-amber-100 text-amber-800' },
  approved: { icon: BadgeCheck, title: 'Approved — welcome aboard', tone: 'text-emerald-600', chip: 'bg-emerald-100 text-emerald-800' },
  rejected: { icon: RotateCcw, title: 'Not approved this time', tone: 'text-rose-600', chip: 'bg-rose-100 text-rose-800' },
};

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)]';

function ApplyForm({ initial, onDone }) {
  const toast = useShop((s) => s.toast);
  const [form, setForm] = useState({
    businessName: initial?.businessName || '',
    contactPhone: initial?.contactPhone || '',
    gstin: initial?.gstin || '',
    city: initial?.city || '',
    categories: (initial?.categories || []).join(', '),
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.businessName.trim()) return;
    setBusy(true);
    try {
      const body = {
        businessName: form.businessName.trim(),
        contactPhone: form.contactPhone.trim() || undefined,
        gstin: form.gstin.trim() || undefined,
        city: form.city.trim() || undefined,
        categories: form.categories.split(',').map((c) => c.trim()).filter(Boolean),
      };
      await api.marketplace.applyVendor(body);
      toast('Application submitted — the platform team will review it.', 'success');
      onDone();
    } catch (err) {
      toast(err?.message || 'Could not submit the application.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Business name *">
        <input className={inputCls} value={form.businessName} onChange={set('businessName')} placeholder="e.g. Malabar Roses" maxLength={120} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact phone">
          <input className={inputCls} value={form.contactPhone} onChange={set('contactPhone')} placeholder="10-digit mobile" maxLength={20} />
        </Field>
        <Field label="City">
          <input className={inputCls} value={form.city} onChange={set('city')} placeholder="e.g. Kochi" maxLength={80} />
        </Field>
      </div>
      <Field label="GSTIN" hint="Optional now — required before your products can go live.">
        <input className={inputCls} value={form.gstin} onChange={set('gstin')} placeholder="e.g. 32ABCDE1234F1Z5" maxLength={20} />
      </Field>
      <Field label="What will you sell?" hint="Comma-separated, e.g. roses, orchids, bouquets.">
        <input className={inputCls} value={form.categories} onChange={set('categories')} placeholder="roses, orchids, …" />
      </Field>
      <Button type="submit" loading={busy} disabled={!form.businessName.trim()} icon={Store}>
        {initial ? 'Update application' : 'Apply to sell'}
      </Button>
    </form>
  );
}

function ApplicationStatus({ data, onEdit }) {
  const app = data?.application;
  const vendor = data?.vendor;
  const meta = STATUS_META[app?.status] || STATUS_META.submitted;
  const Icon = meta.icon;
  const rejected = app?.status === 'rejected';

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100">
          <Icon className={`h-5 w-5 ${meta.tone}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-900">{app?.businessName}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.chip}`}>{meta.title}</span>
          </div>
          {app?.note && (
            <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
              Reviewer note: {app.note}
            </p>
          )}
          {!rejected && !app?.note && (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Nothing for you to do — we will show the decision here as soon as the platform team reviews it.
            </p>
          )}
          {vendor && (
            <p className="mt-2 text-xs text-slate-500">
              Vendor account <span className="font-semibold text-slate-700">{vendor.businessName}</span> is {vendor.status}.
              Products you submit go live after a quick quality review.
            </p>
          )}
        </div>
      </div>
      {rejected && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-4 text-sm font-bold text-slate-900">Apply again with corrections</p>
          <ApplyForm initial={app} onDone={onEdit} />
        </div>
      )}
    </div>
  );
}

export default function Sell() {
  const store = useShop((s) => s.store);
  const openAuth = useShop((s) => s.openAuth);
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const [state, setState] = useState({ loading: true, data: null });

  const load = async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await api.marketplace.myApplication();
      setState({ loading: false, data: r.data });
    } catch {
      setState({ loading: false, data: null });
    }
  };

  useEffect(() => {
    if (isAuth) load();
    else setState({ loading: false, data: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuth]);

  return (
    <div className="wrap py-10">
      <div className="mx-auto max-w-2xl">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          <Flower2 className="h-4 w-4" style={{ color: 'var(--brand)' }} />
          Sell on {store?.name || 'our marketplace'}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-slate-900">
          Growers &amp; florists, sell where customers already shop.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          One application, reviewed by a human. Approved vendors list products that flow
          into store catalogues, with commission settled automatically each billing period.
        </p>

        <div className="mt-8">
          {!isAuth ? (
            <Empty
              icon={Store}
              title="Sign in to apply"
              message="Vendor applications live on your account, so sign in (or create one) and your progress is saved."
              action={<Button onClick={() => openAuth()}>Sign in / create account</Button>}
            />
          ) : state.loading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          ) : state.data?.application ? (
            <ApplicationStatus data={state.data} onEdit={load} />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <ApplyForm onDone={load} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
