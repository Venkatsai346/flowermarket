import { useState } from 'react';
import { Download, History, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { inr, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { saveDownload } from '../../lib/download.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Stat from '../../components/ui/Stat.jsx';
import InventoryLedgerDrawer from './InventoryLedgerDrawer.jsx';
import AdjustStockModal from './AdjustStockModal.jsx';
import { INVENTORY_HEALTH_META, INVENTORY_HEALTH_OPTIONS } from './inventoryMeta.js';

export default function InventoryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [health, setHealth] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const [adjustRow, setAdjustRow] = useState(null);
  const [exporting, setExporting] = useState(false);

  const { data: rows, meta, loading, error, refetch } = useApi(
    () => api.admin.inventory({
      page,
      limit: 20,
      search: search || undefined,
      health: health || undefined,
      lowStockThreshold: undefined,
    }),
    [page, search, health, refreshKey],
  );
  const { data: summary } = useApi(() => api.admin.inventorySummary(), [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);
  const download = async () => {
    setExporting(true);
    try {
      await saveDownload(await api.admin.exportInventory({ search: search || undefined, health: health || undefined }), 'inventory.csv');
      toast.success('Inventory CSV downloaded');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Stock health, ledger and manual adjustments."
        actions={
          <>
            <Button variant="secondary" icon={Download} loading={exporting} onClick={download}>Export CSV</Button>
            <Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh</Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="SKUs" value={summary?.totalSku ?? '—'} sub="active listings" icon={SlidersHorizontal} tone="slate" />
        <Stat label="In stock" value={summary?.inStock ?? '—'} sub="available stay healthy" icon={SlidersHorizontal} tone="emerald" />
        <Stat label="Low stock" value={summary?.lowStock ?? '—'} sub={`threshold ${summary?.lowStockThreshold ?? 5}`} icon={SlidersHorizontal} tone="amber" />
        <Stat label="Out of stock" value={summary?.outOfStock ?? '—'} sub="need attention" icon={SlidersHorizontal} tone="rose" />
        <Stat label="On-hand value" value={inr(summary?.onHandValue)} sub={`${summary?.reservedUnits ?? 0} reserved units`} icon={SlidersHorizontal} tone="sky" />
      </div>

      {error && !rows ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div>
            <p className="text-sm font-semibold text-rose-700">Couldn’t load inventory</p>
            <p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refetch}>Retry</Button>
        </div>
      ) : loading && !rows ? (
        <LoadingBlock />
      ) : (
        <Card
          title="Stock list"
          subtitle="Ordered by health — open the ledger for movements or adjust directly."
          bodyClassName="p-0!"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9!" placeholder="Search title or SKU…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select className="w-48!" value={health} onChange={(e) => { setHealth(e.target.value); setPage(1); }}>
              {INVENTORY_HEALTH_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>

          <Table
            loading={loading && !rows}
            data={rows || []}
            onRowClick={(r) => setSelected(r)}
            empty={<EmptyState icon={SlidersHorizontal} title="No inventory found" message="Clear the filters to see every active listing." />}
            columns={[
              { key: 'title', header: 'Product', render: (r) => (
                <div>
                  <p className="font-medium text-slate-800">{r.title || 'Item'}</p>
                  <p className="font-mono text-xs text-slate-400">{r.skuGlobal || '—'}</p>
                </div>
              ) },
              { key: 'price', header: 'Price', align: 'right', render: (r) => <span className="text-sm text-slate-700">{r.price?.sellingPrice != null ? inr(r.price.sellingPrice) : '—'}</span> },
              { key: 'onHand', header: 'On hand', align: 'right', render: (r) => <span className="font-semibold">{r.qtyOnHand ?? 0}</span> },
              { key: 'reserved', header: 'Reserved', align: 'right', render: (r) => <span className="text-slate-500">{r.qtyReserved ?? 0}</span> },
              { key: 'available', header: 'Available', align: 'right', render: (r) => <span className="font-semibold">{r.available ?? 0}</span> },
              { key: 'health', header: 'Health', render: (r) => <Badge tone={pickMeta(INVENTORY_HEALTH_META, r.health).tone} dot>{pickMeta(INVENTORY_HEALTH_META, r.health).label}</Badge> },
              { key: 'restock', header: 'Restock hint', align: 'right', render: (r) => <span className="text-xs text-slate-500">{r.restockSuggestion ? `+${r.restockSuggestion}` : '—'}</span> },
              { key: 'actions', header: '', align: 'right', render: (r) => (
                <div className="flex justify-end gap-1.5">
                  <Button variant="ghost" size="sm" icon={History} aria-label="Ledger" onClick={(e) => { e.stopPropagation(); setSelected(r); }}>Ledger</Button>
                  <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={(e) => { e.stopPropagation(); setAdjustRow(r); }}>Adjust</Button>
                </div>
              ) },
            ]}
            footer={<Pagination meta={meta} onPage={setPage} />}
          />
        </Card>
      )}

      {selected && <InventoryLedgerDrawer row={selected} onClose={() => setSelected(null)} onChanged={refresh} />}
      {adjustRow && <AdjustStockModal row={adjustRow} onClose={() => { setAdjustRow(null); refresh(); }} />}
    </div>
  );
}
