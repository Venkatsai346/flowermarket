import { useState } from 'react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import Card from '../../components/ui/Card.jsx';
import Field from '../../components/ui/Field.jsx';
import Button from '../../components/ui/Button.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import { Save, Store, Globe, CreditCard, Bell } from 'lucide-react';

/**
 * Tenant Settings Page — manage store-level configuration.
 * Covers: store info, payment settings, notification preferences, feature flags.
 */
export default function TenantSettingsPage() {
  const { data, loading, refetch } = useApi(() => api.marketplace.myStore(), []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const store = data?.store || data?.tenant || data || {};
  const [form, setForm] = useState({
    name: store.name || '',
    tagline: store.tagline || '',
    description: store.description || '',
    phone: store.phone || '',
    email: store.email || '',
    gstin: store.gstin || '',
    city: store.address?.city || '',
    state: store.address?.state || '',
  });

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.marketplace.updateMyStore({
        name: form.name,
        tagline: form.tagline,
        description: form.description,
        phone: form.phone,
        email: form.email,
        gstin: form.gstin,
        address: { city: form.city, state: form.state },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* noop */ } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <LoadingBlock label="Loading settings…" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Store Settings"
        subtitle="Configure your store details, contact info, and preferences."
        actions={
          <Button size="sm" icon={Save} loading={saving} onClick={handleSave}>
            {saved ? 'Saved!' : 'Save changes'}
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Store Info */}
        <Card title="Store Information" subtitle="Basic details shown to customers">
          <div className="space-y-4 p-4">
            <Field label="Store name" required>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" maxLength={100} />
            </Field>
            <Field label="Tagline">
              <input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} className="input" placeholder="Fresh flowers, delivered" maxLength={200} />
            </Field>
            <Field label="Description">
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input min-h-[80px] resize-y" maxLength={2000} placeholder="Tell customers about your store…" />
            </Field>
          </div>
        </Card>

        {/* Contact */}
        <Card title="Contact Details" subtitle="How customers reach you">
          <div className="space-y-4 p-4">
            <Field label="Phone">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" placeholder="+91 98765 43210" />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" placeholder="hello@store.com" />
            </Field>
            <Field label="GSTIN">
              <input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} className="input font-mono" placeholder="37AAACB1234F1Z5" maxLength={15} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="input" />
              </Field>
              <Field label="State">
                <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="input" />
              </Field>
            </div>
          </div>
        </Card>

        {/* Status */}
        <Card title="Store Status">
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Published</span>
              <Badge color={store.isPublished ? 'emerald' : 'amber'}>
                {store.isPublished ? 'Live' : 'Draft'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Store slug</span>
              <code className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">{store.slug || '—'}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Created</span>
              <span className="text-sm text-slate-500">{store.createdAt ? new Date(store.createdAt).toLocaleDateString('en-IN') : '—'}</span>
            </div>
          </div>
        </Card>

        {/* Quick Links */}
        <Card title="Quick Actions">
          <div className="grid grid-cols-2 gap-3 p-4">
            <a href="/storefront" className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 hover:border-rose-300 hover:bg-rose-50">
              <Store className="h-4 w-4 text-rose-500" /> Branding
            </a>
            <a href="/domains" className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 hover:border-rose-300 hover:bg-rose-50">
              <Globe className="h-4 w-4 text-sky-500" /> Domains
            </a>
            <a href="/billing" className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 hover:border-rose-300 hover:bg-rose-50">
              <CreditCard className="h-4 w-4 text-violet-500" /> Billing
            </a>
            <a href="/policies" className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 hover:border-rose-300 hover:bg-rose-50">
              <Bell className="h-4 w-4 text-amber-500" /> Policies
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
