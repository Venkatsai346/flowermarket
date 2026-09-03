import { useEffect, useState } from 'react';
import { Boxes, Download, PackagePlus, Pencil, RefreshCw, Trash2, Warehouse } from 'lucide-react';
import { inr, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { useDownload } from '../../lib/useDownload.js';
import { errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import FilterBar from '../../components/ui/FilterBar.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Stat from '../../components/ui/Stat.jsx';
import Table from '../../components/ui/Table.jsx';
import { LISTING_STATUS_META, LISTING_STATUS_OPTIONS } from './catalogMeta.js';

const blank = () => ({
  productMasterId: '',
  mrp: '',
  sellingPrice: '',
  stockQty: 0,
  status: 'draft',
});

function CreateListingModal({ masters, onClose, onSaved }) {
  const { busy, run } = useAction();
  const [form, setForm] = useState(blank());
  const [error, setError] = useState('');
  const hasPrices = form.mrp !== '' && form.sellingPrice !== '' && Number(form.sellingPrice) > 0;
  const canSave = form.productMasterId && hasPrices;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const mrp = form.mrp === '' ? null : Number(form.mrp);
    const price = { mrp: mrp ?? 0, sellingPrice: Number(form.sellingPrice), currency: 'INR' };
    if (mrp != null && mrp < price.sellingPrice) return setError('MRP must be greater than or equal to the selling price.');
    try {
      await run(() => api.catalogTenant.createListing({
        productMasterId: form.productMasterId,
        price,
        stockQty: Math.max(0, Math.trunc(Number(form.stockQty) || 0)),
        status: form.status,
      }));
      toast.success('Listing created — it is now editable from this page');
      onClose();
      onSaved?.();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create listing"
      subtitle="Attaches an active global master to this store with its own price."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button icon={PackagePlus} loading={busy} disabled={!canSave} onClick={submit}>Create listing</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</div>}
        <Field label="Product master" required hint="Only active masters can be listed.">
          <Select value={form.productMasterId} onChange={(e) => set('productMasterId', e.target.value)}>
            <option value="">Select master…</option>
            {(masters || []).map((m) => <option key={rid(m)} value={rid(m)}>{m.title} · {m.skuGlobal}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Selling price (₹)" required>
            <Input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => set('sellingPrice', e.target.value)} />
          </Field>
          <Field label="MRP (₹)" hint="Leave blank when no MRP.">
            <Input type="number" min="0" step="0.01" value={form.mrp} onChange={(e) => set('mrp', e.target.value)} />
          </Field>
          <Field label="Opening stock" hint="Creates the inventory row when > 0.">
            <Input type="number" min="0" step="1" value={form.stockQty} onChange={(e) => set('stockQty', e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {LISTING_STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l.label}</option>)}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-slate-400">Activating a listing will surface it to customers as soon as pricing is valid.</p>
      </form>
    </Modal>
  );
}

function ListingModal({ row, onClose, onSaved }) {
  const { busy, run } = useAction();
  const [priceForm, setPriceForm] = useState({ mrp: row.price?.mrp ?? '', sellingPrice: row.price?.sellingPrice ?? '', reason: 'manual' });
  const [stockQty, setStockQty] = useState('0');
  const [stockData, setStockData] = useState(null);
  const [loadingStock, setLoadingStock] = useState(true);
  const [serverError, setServerError] = useState('');
  const listingId = row.id || row._id;
  const version = row.version || 1;
  const status = row.status || 'draft';

  const onChanged = () => { loadStock(); onSaved?.(); };

  const loadStock = async () => {
    setLoadingStock(true);
    try {
      const r = await api.catalogTenant.stock(listingId);
      setStockData(r.data);
      setStockQty(String(r.data.qtyOnHand ?? 0));
    } catch (e) {
      setServerError(errMsg(e));
    } finally {
      setLoadingStock(false);
    }
  };

  useEffect(() => { loadStock(); return undefined; }, [listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePrice = async (e) => {
    e.preventDefault();
    setServerError('');
    const mrp = priceForm.mrp === '' ? null : Number(priceForm.mrp);
    if (mrp == null || mrp < Number(priceForm.sellingPrice)) return setServerError('MRP is required and must be greater than or equal to the selling price.');
    try {
      await run(() => api.catalogTenant.updatePrice(listingId, {
        price: { mrp: mrp ?? 0, sellingPrice: Number(priceForm.sellingPrice), currency: 'INR' },
        reason: priceForm.reason,
        expectedVersion: version,
      }));
      toast.success('Listing price updated');
      onChanged();
    } catch (err) {
      setServerError(errMsg(err));
    }
  };

  const saveStock = async (e) => {
    e.preventDefault();
    setServerError('');
    try {
      await run(() => api.catalogTenant.setStock(listingId, { qty: Math.max(0, Math.trunc(Number(stockQty) || 0)) }));
      toast.success('Stock snapshot set');
      onChanged();
    } catch (err) {
      setServerError(errMsg(err));
    }
  };

  const setStatus = async (next) => {
    try {
      await run(() => api.catalogTenant.updateStatus(listingId, { status: next, expectedVersion: version }));
      toast.success(`Listing ${next}`);
      onChanged();
    } catch (err) {
      setServerError(errMsg(err));
    }
  };

  const deactivate = async () => {
    try {
      await run(() => api.catalogTenant.deactivateListing(listingId, { expectedVersion: version }));
      toast.success('Listing deactivated');
      onChanged();
    } catch (err) {
      setServerError(errMsg(err));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={row.master?.title || row.title || 'Listing'}
      subtitle={`SKU ${row.master?.skuGlobal || row.skuGlobal || '—'} · v${version}`}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <p className="text-xs text-slate-400">Backend enforces status transitions and version conflicts.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            {status !== 'inactive'
              ? <Button variant="danger" onClick={deactivate}>Deactivate</Button>
              : <Button variant="success" onClick={() => setStatus('active')}>Activate</Button>}
          </div>
        </div>
      }
    >
      {serverError && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{serverError}</div>}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-400">Status</p>
          <div className="mt-1"><Badge tone={pickMeta(LISTING_STATUS_META, status).tone} dot>{pickMeta(LISTING_STATUS_META, status).label}</Badge></div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-400">On hand</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{stockData?.qtyOnHand ?? row.stockQty ?? 0}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-400">Reserved</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{stockData?.qtyReserved ?? 0}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-400">Available</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{stockData?.qtyAvailable ?? row.stockQty ?? 0}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={savePrice} className="rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-800">Price</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label="Selling ₹" required><Input type="number" min="0" step="0.01" value={priceForm.sellingPrice} onChange={(e) => setPriceForm({ ...priceForm, sellingPrice: e.target.value })} /></Field>
            <Field label="MRP ₹"><Input type="number" min="0" step="0.01" value={priceForm.mrp} onChange={(e) => setPriceForm({ ...priceForm, mrp: e.target.value })} /></Field>
            <Field label="Reason">
              <Select value={priceForm.reason} onChange={(e) => setPriceForm({ ...priceForm, reason: e.target.value })}>
                {['manual', 'promotion', 'bulk', 'admin_override', 'reset'].map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex justify-end"><Button type="submit" size="sm" loading={busy}>Save price</Button></div>
        </form>

        <form onSubmit={saveStock} className="rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-800">Stock</p>
          {loadingStock ? <p className="mt-3 text-xs text-slate-400">Loading inventory…</p> : (
            <>
              <div className="mt-3"><Field label="On-hand quantity" hint="Sets the absolute stock snapshot."><Input type="number" min="0" step="1" value={stockQty} onChange={(e) => setStockQty(e.target.value)} /></Field></div>
              <div className="mt-3 flex justify-end"><Button type="submit" size="sm" variant="secondary" icon={Warehouse} loading={busy}>Set stock</Button></div>
            </>
          )}
        </form>
      </div>
    </Modal>
  );
}

export default function ListingPanel() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState(null);
  const { busy: exporting, run: download } = useDownload();

  const { data, meta, loading, error, refetch } = useApi(
    () => api.catalogTenant.listings({
      page, limit: 20,
      search: search || undefined,
      status: status || undefined,
    }),
    [page, search, status, refreshKey],
  );
  const masters = useApi(() => api.catalogAdmin.masters({ status: 'active', limit: 100 }), []);

  const refresh = () => setRefreshKey((k) => k + 1);
  const rows = data || [];
  const counts = { draft: 0, active: 0, inactive: 0, out_of_stock: 0 };
  rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });

  const saveTemplate = () => download(
    () => api.catalogTenant.bulkTemplate('price'),
    'price-template.csv',
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active" value={counts.active ?? 0} sub="on this page" icon={Boxes} tone="emerald" />
        <Stat label="Draft" value={counts.draft ?? 0} sub="not yet sellable" icon={Boxes} tone="slate" />
        <Stat label="Inactive" value={counts.inactive ?? 0} sub="paused / deactivated" icon={Boxes} tone="rose" />
        <Stat label="Out of stock" value={counts.out_of_stock ?? 0} sub="snapshot zeroed" icon={Boxes} tone="amber" />
      </div>

      {error && !rows.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div><p className="text-sm font-semibold text-rose-700">Couldn’t load listings</p><p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p></div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>
        </div>
      ) : (
        <Card
          title="Tenant listings"
          subtitle="Price and stock changes append audit + price-history rows."
          bodyClassName="p-0!"
          actions={
            <>
              <Button variant="ghost" size="sm" icon={Download} loading={exporting} onClick={saveTemplate}>{exporting ? 'Preparing…' : 'Price template'}</Button>
              <Button variant="primary" size="sm" icon={PackagePlus} onClick={() => setCreate(true)}>Create listing</Button>
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh}>Refresh</Button>
            </>
          }
        >
          <FilterBar
            search={search}
            onSearch={(v) => { setSearch(v); setPage(1); }}
            searchPlaceholder="Search title or SKU…"
            status={status}
            statusOptions={Object.entries(LISTING_STATUS_META).map(([v, m]) => [v, m.label])}
            onStatus={(v) => { setStatus(v); setPage(1); }}
            statusLabel="Status"
            onReset={() => { setSearch(''); setStatus(''); setPage(1); }}
          />

          <Table
            loading={loading && !rows.length}
            data={rows}
            onRowClick={(r) => setSelected(r)}
            empty={<EmptyState icon={Boxes} title="No listings found" message="Attach a global master to this store to start selling." />}
            columns={[
              { key: 'name', header: 'Listing', render: (r) => (
                <div>
                  <p className="font-medium text-slate-800">{r.master?.title || r.title || 'Untitled'}</p>
                  <p className="font-mono text-xs text-slate-400">{r.master?.skuGlobal || r.skuGlobal || '—'}</p>
                </div>
              ) },
              { key: 'price', header: 'Selling', align: 'right', render: (r) => <span className="text-sm">{inr(r.price?.sellingPrice)}</span> },
              { key: 'stock', header: 'Stock', align: 'right', render: (r) => <span className="text-xs text-slate-600">{r.stockQty ?? 0}</span> },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={pickMeta(LISTING_STATUS_META, r.status).tone} dot>{pickMeta(LISTING_STATUS_META, r.status).label}</Badge> },
              { key: 'version', header: 'v', align: 'right', render: (r) => <span className="text-xs text-slate-400">{r.version ?? 1}</span> },
              { key: 'actions', header: '', align: 'right', render: (r) => (
                <div className="flex justify-end gap-1.5">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={(e) => { e.stopPropagation(); setSelected(r); }}>Manage</Button>
                  {r.status === 'active' && (
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={(e) => { e.stopPropagation(); (async () => { try { await api.catalogTenant.deactivateListing(r.id, { expectedVersion: r.version || 1 }); toast.success('Listing deactivated'); refresh(); } catch (err) { toast.error(errMsg(err)); } })(); }}>Deactivate</Button>
                  )}
                </div>
              ) },
            ]}
            footer={<Pagination meta={meta} onPage={setPage} />}
          />
        </Card>
      )}

      {selected && <ListingModal row={selected} onClose={() => setSelected(null)} onSaved={refresh} />}
      {create && <CreateListingModal masters={masters.data || []} onClose={() => setCreate(false)} onSaved={refresh} />}
    </div>
  );
}
