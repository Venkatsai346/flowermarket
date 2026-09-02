import { useState } from 'react';
import { Package, RefreshCw, Search, SearchX } from 'lucide-react';
import { inr, inr0, num, pickMeta, PRODUCT_MASTER_STATUS_META, titleCase } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Field, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

const HEALTH = [
  ['', 'All health'],
  ['in_stock', 'In stock'],
  ['low_stock', 'Low stock'],
  ['out_of_stock', 'Out of stock'],
];

function ProductDetail({ productId, onClose, onChanged }) {
  const { data, loading, error } = useApi(() => api.admin.product(productId), [productId]);
  const { busy, run } = useAction();
  const [form, setForm] = useState({ type: 'restock', qtyChange: '', reason: '' });

  const master = data?.master || {};
  const listings = data?.listings || [];
  const primary = listings[0];

  const adjust = async (e) => {
    e.preventDefault();
    if (!primary) return;
    try {
      await run(() =>
        api.admin.adjustInventory(primary.id, {
          type: form.type,
          qtyChange: Number(form.qtyChange),
          reason: form.reason,
        })
      );
      toast.success('Inventory updated');
      setForm({ type: 'restock', qtyChange: '', reason: '' });
      onChanged?.();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal open onClose={onClose} title={master.title || 'Product'} subtitle={`SKU ${master.skuGlobal || '—'}`} size="lg">
      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : error ? (
        <p className="py-8 text-center text-sm text-rose-600">{errMsg(error)}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3.5">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Type</p>
              <p className="mt-0.5 text-sm font-medium text-slate-800">{titleCase(master.type)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Status</p>
              <div className="mt-1">
                <Badge tone={pickMeta(PRODUCT_MASTER_STATUS_META, master.status).tone}>
                  {pickMeta(PRODUCT_MASTER_STATUS_META, master.status).label}
                </Badge>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5">
              <p className="text-[11px] font-semibold uppercase text-slate-400">Vendor</p>
              <p className="mt-0.5 text-sm font-medium text-slate-800">{master.vendorId ? 'Marketplace vendor' : 'Platform'}</p>
            </div>
          </div>

          {primary ? (
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Listing (this store)</p>
                  <p className="mt-1 text-xs text-slate-500">
                    MRP {inr(primary.price?.mrp)} · Selling {inr(primary.price?.sellingPrice)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-slate-900">{num(primary.stock?.qtyOnHand ?? 0)}</p>
                  <p className="text-xs text-slate-500">
                    on hand · {num(primary.stock?.available ?? 0)} available
                  </p>
                </div>
              </div>

              <form onSubmit={adjust} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[160px_120px_1fr_auto]">
                <Field label="Adjustment">
                  <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                    <option value="restock">Restock (+)</option>
                    <option value="shrinkage">Shrinkage (−)</option>
                    <option value="audit_correction">Audit correction</option>
                  </Select>
                </Field>
                <Field label="Qty" required>
                  <Input
                    type="number"
                    required
                    min={1}
                    value={form.qtyChange}
                    onChange={(e) => setForm((f) => ({ ...f, qtyChange: e.target.value }))}
                    placeholder="10"
                  />
                </Field>
                <Field label="Reason" required>
                  <Input required value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Received from vendor" />
                </Field>
                <div className="flex items-end">
                  <Button type="submit" loading={busy}>Apply</Button>
                </div>
              </form>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No listing in this store yet.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function CatalogPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [health, setHealth] = useState('');
  const [limit] = useState(20);
  const [selectedId, setSelectedId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, meta, loading, refetch } = useApi(
    () => api.admin.products({ page, limit, search: search || undefined, health: health || undefined }),
    [page, search, health, refreshKey]
  );

  const refresh = () => { setRefreshKey((k) => k + 1); refetch(); };

  return (
    <div>
      <PageHeader
        title="Catalog"
        description="Products listed in this store — prices, stock and health."
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh</Button>}
      />

      <Card bodyClassName="p-0!">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9!"
              placeholder="Search SKU or title…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select className="w-44!" value={health} onChange={(e) => { setHealth(e.target.value); setPage(1); }}>
            {HEALTH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>

        <Table
          loading={loading && !data}
          data={data || []}
          onRowClick={(row) => setSelectedId(row.id)}
          empty={<EmptyState icon={SearchX} title="No products found" message="Try a different search or health filter." />}
          columns={[
            { key: 'sku', header: 'SKU', render: (r) => <span className="font-mono text-xs text-slate-500">{r.skuGlobal || '—'}</span> },
            { key: 'title', header: 'Title', render: (r) => (
              <div>
                <p className="font-medium text-slate-800">{r.title}</p>
                <p className="text-[11px] text-slate-400">{titleCase(r.type)}</p>
              </div>
            ) },
            { key: 'price', header: 'Selling', align: 'right', render: (r) => (
              <div className="text-right">
                <p className="font-semibold text-slate-800">{inr(r.sellingPrice)}</p>
                <p className="text-[11px] text-slate-400 line-through">{inr0(r.mrp)}</p>
              </div>
            ) },
            { key: 'stock', header: 'Stock', align: 'right', render: (r) => (
              <div className="text-right">
                <p className="font-semibold text-slate-800">{num(r.stock?.available ?? 0)}</p>
                <p className="text-[11px] text-slate-400">of {num(r.stock?.qtyOnHand ?? 0)} on hand</p>
              </div>
            ) },
            { key: 'health', header: 'Health', render: (r) => {
              const m = pickMeta({ in_stock: { label: 'In stock', tone: 'emerald' }, low_stock: { label: 'Low stock', tone: 'amber' }, out_of_stock: { label: 'Out of stock', tone: 'rose' } }, r.stock?.health);
              return <Badge tone={m.tone} dot>{m.label}</Badge>;
            } },
            { key: 'status', header: 'Status', render: (r) => {
              const m = pickMeta(PRODUCT_MASTER_STATUS_META, r.status);
              return <Badge tone={m.tone}>{m.label}</Badge>;
            } },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>

      {selectedId && (
        <ProductDetail
          productId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
