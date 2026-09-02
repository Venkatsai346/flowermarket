import { useState } from 'react';
import { Save, Store } from 'lucide-react';
import { bpsToPct, fmtDate, num } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

export default function VendorProfilePage() {
  const me = useApi(() => api.marketplace.vendorMe(), []);
  const { busy, run } = useAction();
  const [form, setForm] = useState(null);

  const v = me.data || {};
  const ready = Boolean(form) || !me.loading;

  const init = () => {
    if (!me.loading && !form) {
      setForm({
        businessName: v.businessName || '',
        city: v.city || '',
        categories: (v.categories || []).join(', '),
        gstin: v.gstin || '',
        payoutMethod: v.payout?.method || '',
        payoutName: v.payout?.name || '',
        payoutAccount: v.payout?.maskedAccount || '',
      });
    }
  };
  init();

  const save = async (e) => {
    e.preventDefault();
    try {
      await run(() =>
        api.marketplace.updateVendorMe({
          businessName: form.businessName,
          city: form.city || null,
          categories: form.categories.split(',').map((s) => s.trim()).filter(Boolean),
          gstin: form.gstin || null,
          payout: {
            method: form.payoutMethod || null,
            name: form.payoutName || null,
            maskedAccount: form.payoutAccount || null,
          },
        })
      );
      toast.success('Vendor profile updated');
      me.refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  if (me.loading && !me.data) return <LoadingBlock label="Loading your vendor profile…" />;

  return (
    <div>
      <PageHeader title="Vendor profile" description="Your seller identity on the marketplace." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <Store className="h-6 w-6" />
            </span>
            <div>
              <p className="font-semibold text-slate-900">{v.businessName || '—'}</p>
              <p className="text-xs text-slate-500">@{v.slug} · {v.city || '—'}</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Badge tone={v.status === 'suspended' ? 'rose' : 'emerald'} dot>{v.status || '—'}</Badge>
            <Badge tone="slate">{bpsToPct(v.commissionRateBps)} commission</Badge>
          </div>
          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Lifetime GMV</dt><dd className="font-bold text-slate-900">{num(v.counters?.gmv ?? 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Orders</dt><dd className="font-bold text-slate-900">{num(v.counters?.orders ?? 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Joined</dt><dd className="font-medium text-slate-800">{fmtDate(v.joinedAt)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">GSTIN</dt><dd className="font-mono text-xs text-slate-700">{v.gstin || '—'}</dd></div>
          </dl>
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Your products go live only after platform review. Approved products sync into
            marketplace-enabled stores.
          </p>
        </Card>

        <Card title="Edit profile" className="lg:col-span-2">
          {ready && form ? (
            <form onSubmit={save} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" required>
                  <Input required value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
                </Field>
                <Field label="City">
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Vizag" />
                </Field>
              </div>
              <Field label="Categories" hint="Comma-separated, e.g. roses, marigold, bouquets">
                <Input value={form.categories} onChange={(e) => setForm({ ...form, categories: e.target.value })} placeholder="roses, bouquets" />
              </Field>
              <Field label="GSTIN">
                <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="37ABCDE1234F1Z5" />
              </Field>
              <div>
                <p className="label">Payout details (metadata only — disbursement is a later phase)</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Select value={form.payoutMethod} onChange={(e) => setForm({ ...form, payoutMethod: e.target.value })}>
                    <option value="">Method…</option>
                    <option value="bank">Bank</option>
                    <option value="upi">UPI</option>
                  </Select>
                  <Input placeholder="Account name" value={form.payoutName} onChange={(e) => setForm({ ...form, payoutName: e.target.value })} />
                  <Input placeholder="Masked account / UPI id" value={form.payoutAccount} onChange={(e) => setForm({ ...form, payoutAccount: e.target.value })} />
                </div>
              </div>
              <div className="flex justify-end border-t border-slate-100 pt-4">
                <Button type="submit" icon={Save} loading={busy}>Save profile</Button>
              </div>
            </form>
          ) : (
            <LoadingBlock />
          )}
        </Card>
      </div>
    </div>
  );
}
