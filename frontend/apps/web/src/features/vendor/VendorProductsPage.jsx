import { useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { fmtDate, pickMeta, PRODUCT_MASTER_STATUS_META, titleCase } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

const TYPES = ['fresh_flower', 'flower_bouquet', 'plant', 'other'];
const PRODUCT_TYPES = {
  fresh_flower: 'Fresh flower',
  flower_bouquet: 'Bouquet',
  plant: 'Plant',
  other: 'Other',
};

export default function VendorProductsPage() {
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const { data, meta, loading, refetch } = useApi(
    () => api.marketplace.vendorProducts({ page, limit: 20 }),
    [page]
  );
  const cats = useApi(() => api.public.categories(), []);
  const { busy, run } = useAction();

  const [form, setForm] = useState({
    title: '',
    type: 'fresh_flower',
    categoryId: '',
    skuGlobal: '',
    shortDescription: '',
    tags: '',
    isPerishable: true,
    minOrderQty: 1,
    maxOrderQty: 100,
  });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await run(() =>
        api.marketplace.createVendorProduct({
          ...form,
          skuGlobal: form.skuGlobal.toUpperCase(),
          tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
        })
      );
      toast.success('Product submitted — pending platform review');
      setCreateOpen(false);
      setForm({ title: '', type: 'fresh_flower', categoryId: '', skuGlobal: '', shortDescription: '', tags: '', isPerishable: true, minOrderQty: 1, maxOrderQty: 100 });
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="My products"
        description="Products you sell on the marketplace. Pending items await platform review."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Add product</Button>}
      />
      <Card bodyClassName="p-0!">
        <Table
          loading={loading && !data}
          data={data || []}
          empty={<EmptyState icon={Package} title="No products yet" message="Add your first product — it goes to platform review before going live." />}
          columns={[
            { key: 'sku', header: 'SKU', render: (r) => <span className="font-mono text-xs text-slate-500">{r.skuGlobal}</span> },
            { key: 'title', header: 'Title', render: (r) => (
              <div>
                <p className="font-medium text-slate-800">{r.title}</p>
                <p className="text-[11px] text-slate-400">{PRODUCT_TYPES[r.type] || titleCase(r.type)}</p>
              </div>
            ) },
            { key: 'status', header: 'Status', render: (r) => {
              const m = pickMeta(PRODUCT_MASTER_STATUS_META, r.status);
              return <Badge tone={m.tone} dot>{m.label}</Badge>;
            } },
            { key: 'listed', header: 'Marketplace', render: (r) => (
              <Badge tone={r.marketplaceListed ? 'emerald' : 'slate'}>{r.marketplaceListed ? 'Listed' : 'Not listed'}</Badge>
            ) },
            { key: 'createdAt', header: 'Created', render: (r) => fmtDate(r.createdAt) },
          ]}
        />
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a marketplace product"
        subtitle="Submitted for platform review; pricing is set per-store when synced."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submit}>Submit for review</Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Title" required>
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Vizag Rose Bouquet (12 stems)" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" required>
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPES[t] || t}</option>)}
              </Select>
            </Field>
            <Field label="SKU" required hint="Unique, uppercase">
              <Input required value={form.skuGlobal} onChange={(e) => setForm({ ...form, skuGlobal: e.target.value.toUpperCase() })} placeholder="VIZ-ROSE-12" />
            </Field>
          </div>
          <Field label="Category" required hint="Pick the closest catalog category">
            <Select required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Select category…</option>
              {(cats.data || []).map((c) => (
                <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Short description">
            <Textarea value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} placeholder="Fresh-cut roses sourced from local farms…" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tags" hint="Comma-separated">
              <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="roses, wedding, bulk" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min qty"><Input type="number" min={1} value={form.minOrderQty} onChange={(e) => setForm({ ...form, minOrderQty: Number(e.target.value) })} /></Field>
              <Field label="Max qty"><Input type="number" min={1} value={form.maxOrderQty} onChange={(e) => setForm({ ...form, maxOrderQty: Number(e.target.value) })} /></Field>
            </div>
          </div>
          <Checkbox
            label="Perishable product"
            checked={form.isPerishable}
            onChange={(e) => setForm({ ...form, isPerishable: e.target.checked })}
          />
        </form>
      </Modal>
    </div>
  );
}
