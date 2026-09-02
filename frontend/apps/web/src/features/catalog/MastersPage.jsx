import { useMemo, useState } from 'react';
import { Package, Plus, RefreshCw, Search, SearchX } from 'lucide-react';
import { fmtDate, pickMeta, PRODUCT_MASTER_STATUS_META, PRODUCT_TYPE_META } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { rid } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import MasterFormModal from './MasterFormModal.jsx';
import MasterDetailModal from './MasterDetailModal.jsx';

const STATUSES = [
  ['', 'All statuses'],
  ['active', 'Active'],
  ['pending_review', 'Pending review'],
  ['rejected', 'Rejected'],
  ['deprecated', 'Deprecated'],
];
const TYPES = Object.keys(PRODUCT_TYPE_META);

export default function MastersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [type, setType] = useState('');
  const [selected, setSelected] = useState(null); // detail
  const [form, setForm] = useState(null); // {mode:'create'} | {mode:'edit', master}
  const [limit] = useState(20);

  const masters = useApi(
    () =>
      api.catalogAdmin.masters({
        page, limit,
        search: search || undefined,
        status: status || undefined,
        categoryId: categoryId || undefined,
        brandId: brandId || undefined,
        type: type || undefined,
      }),
    [page, search, status, categoryId, brandId, type]
  );
  const cats = useApi(() => api.catalogAdmin.categories({ limit: 100 }), []);
  const brands = useApi(() => api.catalogAdmin.brands({ limit: 100 }), []);

  const catName = useMemo(() => {
    const map = new Map();
    (cats.data || []).forEach((c) => map.set(rid(c), c.name));
    return map;
  }, [cats.data]);
  const brandName = useMemo(() => {
    const map = new Map();
    (brands.data || []).forEach((b) => map.set(rid(b), b.name));
    return map;
  }, [brands.data]);

  const refresh = () => { masters.refetch(); cats.refetch(); brands.refetch(); };
  const rows = (masters.data || []).map((r) => ({ ...r, id: rid(r) }));

  return (
    <div>
      <PageHeader
        title="Product masters"
        description="The global catalog — shared across every store. Pricing and stock live on tenant listings."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh</Button>
            <Button icon={Plus} onClick={() => setForm({ mode: 'create' })}>New master</Button>
          </>
        }
      />

      <Card bodyClassName="!p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="!pl-9" placeholder="Search SKU, title…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <Select className="!w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select className="!w-44" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
            <option value="">All categories</option>
            {(cats.data || []).map((c) => <option key={rid(c)} value={rid(c)}>{c.name}</option>)}
          </Select>
          <Select className="!w-44" value={brandId} onChange={(e) => { setBrandId(e.target.value); setPage(1); }}>
            <option value="">All brands</option>
            {(brands.data || []).map((b) => <option key={rid(b)} value={rid(b)}>{b.name}</option>)}
          </Select>
          <Select className="!w-40" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPE_META[t].label}</option>)}
          </Select>
        </div>

        <Table
          loading={masters.loading && !masters.data}
          data={rows}
          onRowClick={(r) => setSelected(r.id)}
          empty={<EmptyState icon={Package} title="No masters found" message="Adjust the filters or create a new product master." />}
          columns={[
            { key: 'sku', header: 'SKU', render: (r) => <span className="font-mono text-xs text-slate-500">{r.skuGlobal}</span> },
            { key: 'title', header: 'Title', render: (r) => (
              <div>
                <p className="font-medium text-slate-800">{r.title}</p>
                <p className="text-[11px] text-slate-400">{pickMeta(PRODUCT_TYPE_META, r.type).label}</p>
              </div>
            ) },
            { key: 'category', header: 'Category', render: (r) => catName.get(r.categoryId) || '—' },
            { key: 'brand', header: 'Brand', render: (r) => brandName.get(r.brandId) || '—' },
            { key: 'status', header: 'Status', render: (r) => {
              const m = pickMeta(PRODUCT_MASTER_STATUS_META, r.status);
              return <Badge tone={m.tone} dot>{m.label}</Badge>;
            } },
            { key: 'flags', header: '', render: (r) => (
              <div className="flex gap-1">
                {r.vendorId && <Badge tone="emerald">vendor</Badge>}
                {r.marketplaceListed && <Badge tone="violet">listed</Badge>}
              </div>
            ) },
            { key: 'version', header: 'v', align: 'right', render: (r) => <span className="text-xs text-slate-400">{r.version ?? 1}</span> },
            { key: 'updatedAt', header: 'Updated', render: (r) => fmtDate(r.updatedAt) },
          ]}
          footer={<Pagination meta={masters.meta} onPage={setPage} />}
        />
      </Card>

      {selected && (
        <MasterDetailModal
          masterId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => masters.refetch()}
        />
      )}

      {form && (
        <MasterFormModal
          open
          onClose={() => setForm(null)}
          initial={form.mode === 'edit' ? form.master : null}
          categories={cats.data || []}
          brands={brands.data || []}
          onSaved={(doc, refetchOnly) => {
            if (refetchOnly) { masters.refetch(); return; }
            setForm(null);
            masters.refetch();
            if (doc?.id) setSelected(doc.id);
          }}
        />
      )}
    </div>
  );
}
