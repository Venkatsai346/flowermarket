import { useState } from 'react';
import { Banknote, Boxes, CalendarDays, RefreshCw, Truck } from 'lucide-react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { cn } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Stat from '../../components/ui/Stat.jsx';
import PickingQueue from './PickingQueue.jsx';
import DeliveryQueue from './DeliveryQueue.jsx';
import SlotsPanel from './SlotsPanel.jsx';
import PaymentsPanel from './PaymentsPanel.jsx';
import OrderOpsDrawer from './OrderOpsDrawer.jsx';
import { OPS_TABS } from './opsMeta.js';

const TAB_ICONS = {
  picking: Boxes,
  delivery: Truck,
  slots: CalendarDays,
  payments: Banknote,
};

export default function FulfillmentPage() {
  const [tab, setTab] = useState('picking');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState(null);

  const { data: counts, refetch: refetchCounts } = useApi(
    () => Promise.all([
      api.fulfillment.listAll({ status: 'confirmed', page: 1, limit: 1 }),
      api.fulfillment.listAll({ status: 'picking', page: 1, limit: 1 }),
      api.fulfillment.listAll({ status: 'packed', page: 1, limit: 1 }),
      api.fulfillment.listAll({ status: 'out_for_delivery', page: 1, limit: 1 }),
      api.fulfillment.listAll({ status: 'delivery_failed', page: 1, limit: 1 }),
      api.fulfillment.listAll({ status: 'delivered', page: 1, limit: 1 }),
    ]),
    [refreshKey],
  );

  const count = (i) => counts?.[i]?.meta?.total || 0;
  const refresh = () => {
    setRefreshKey((k) => k + 1);
    refetchCounts();
  };

  const onChanged = () => {
    setRefreshKey((k) => k + 1);
    refetchCounts();
  };

  return (
    <div>
      <PageHeader
        title="Fulfillment ops"
        description="Warehouse picking, rider dispatch, delivery slots and payment reconciliation."
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh all</Button>}
      />

      <nav className="mb-5 flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1.5">
        {OPS_TABS.map(([key, label]) => {
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

      {(tab === 'picking' || tab === 'delivery') && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tab === 'picking' ? (
            <>
              <Stat label="To pick" value={count(0)} sub="confirmed" icon={Boxes} tone="sky" />
              <Stat label="Picking now" value={count(1)} sub="in progress" icon={Boxes} tone="violet" />
              <Stat label="Packed" value={count(2)} sub="ready to dispatch" icon={Boxes} tone="emerald" />
              <Stat label="Out for delivery" value={count(3)} sub="rider leg" icon={Truck} tone="amber" />
            </>
          ) : (
            <>
              <Stat label="Packed" value={count(2)} sub="awaiting dispatch" icon={Truck} tone="emerald" />
              <Stat label="Out for delivery" value={count(3)} sub="active rides" icon={Truck} tone="sky" />
              <Stat label="Failed" value={count(4)} sub="needs retry" icon={Truck} tone="rose" />
              <Stat label="Delivered" value={count(5)} sub="completed" icon={Truck} tone="slate" />
            </>
          )}
        </div>
      )}

      {tab === 'picking' && <PickingQueue refreshKey={refreshKey} onOpen={setSelectedOrder} />}
      {tab === 'delivery' && <DeliveryQueue refreshKey={refreshKey} onOpen={setSelectedOrder} />}
      {tab === 'slots' && <SlotsPanel refreshKey={refreshKey} />}
      {tab === 'payments' && <PaymentsPanel refreshKey={refreshKey} />}

      {selectedOrder && (
        <OrderOpsDrawer order={selectedOrder} onClose={() => setSelectedOrder(null)} onChanged={onChanged} />
      )}
    </div>
  );
}
