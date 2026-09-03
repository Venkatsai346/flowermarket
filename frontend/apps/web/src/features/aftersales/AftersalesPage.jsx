import { useState } from 'react';
import { RefreshCw, RotateCcw, Undo2 } from 'lucide-react';
import { useApi } from '../../lib/useApi.js';
import { api } from '../../api.js';
import { cn } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Stat from '../../components/ui/Stat.jsx';
import ReturnsPanel from './ReturnsPanel.jsx';
import RefundsPanel from './RefundsPanel.jsx';
import { RETURN_TABS } from './aftersalesMeta.js';

const TAB_ICONS = {
  returns: RotateCcw,
  refunds: Undo2,
};

export default function AftersalesPage() {
  const [tab, setTab] = useState('returns');
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: counts, refetch: refetchCounts } = useApi(
    () => Promise.all([
      api.fulfillment.returns({ status: 'approved', page: 1, limit: 1 }),
      api.fulfillment.returns({ status: 'picked_up', page: 1, limit: 1 }),
      api.fulfillment.returns({ status: 'refunded', page: 1, limit: 1 }),
      api.fulfillment.refunds({ status: 'pending', page: 1, limit: 1 }),
      api.fulfillment.refunds({ status: 'failed', page: 1, limit: 1 }),
    ]),
    [refreshKey],
  );

  const count = (i) => counts?.[i]?.meta?.total || 0;
  const refresh = () => { setRefreshKey((k) => k + 1); refetchCounts(); };

  return (
    <div>
      <PageHeader
        title="After-sales"
        description="Returns, pickup, QC decisions and refunds."
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh all</Button>}
      />

      <nav className="mb-5 flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1.5">
        {RETURN_TABS.map(([key, label]) => {
          const Icon = TAB_ICONS[key];
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
                tab === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tab === 'returns' ? (
          <>
            <Stat label="To pick up" value={count(0)} sub="approved" icon={RotateCcw} tone="sky" />
            <Stat label="To QC" value={count(1)} sub="picked up" icon={RotateCcw} tone="violet" />
            <Stat label="Refunded" value={count(2)} sub="completed" icon={Undo2} tone="emerald" />
            <Stat label="Refunds pending" value={count(3)} sub="processing" icon={Undo2} tone="amber" />
            <Stat label="Failed refunds" value={count(4)} sub="needs review" icon={Undo2} tone="rose" />
          </>
        ) : (
          <>
            <Stat label="Pending" value={count(3)} sub="processing" icon={Undo2} tone="amber" />
            <Stat label="Failed" value={count(4)} sub="needs review" icon={Undo2} tone="rose" />
            <Stat label="Ready to pick up" value={count(0)} sub="approved returns" icon={RotateCcw} tone="sky" />
            <Stat label="Passed QC" value={count(1)} sub="picked up" icon={RotateCcw} tone="violet" />
            <Stat label="Refunded" value={count(2)} sub="completed" icon={Undo2} tone="emerald" />
          </>
        )}
      </div>

      {tab === 'returns' && <ReturnsPanel refreshKey={refreshKey} />}
      {tab === 'refunds' && <RefundsPanel refreshKey={refreshKey} />}
    </div>
  );
}
