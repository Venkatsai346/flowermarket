import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, Bike, CheckCircle2, Clock3, RefreshCw, Truck,
} from 'lucide-react';
import { pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Select } from '../../components/ui/Field.jsx';
import Stat from '../../components/ui/Stat.jsx';
import AvailabilitySwitch from './AvailabilitySwitch.jsx';
import DeliveryCard from './DeliveryCard.jsx';
import PodCaptureModal from './PodCaptureModal.jsx';
import FailDeliveryModal from './FailDeliveryModal.jsx';
import RejectDeliveryModal from './RejectDeliveryModal.jsx';
import { RIDER_AVAILABILITY_META, RIDER_STATUS_FILTERS } from './riderMeta.js';

const emptyMessage = (status) => {
  if (status === 'pending_accept') return 'No delivery offers waiting. New assignments appear here in real time.';
  if (status) return 'No deliveries in this state.';
  return 'All caught up — no assigned deliveries right now.';
};

export default function RiderDeliveryPage() {
  const [status, setStatus] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [podTarget, setPodTarget] = useState(null);
  const [failTarget, setFailTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const action = useAction();

  const { data: me, refetch: refetchMe } = useApi(() => api.auth.me(), []);
  const availability = me?.rider?.availability || 'offline';

  const { data, loading, refetch } = useApi(
    () => api.rider.deliveries({ status: status || undefined }),
    [status, refreshKey],
  );

  const { data: all, refetch: refetchAll } = useApi(() => api.rider.deliveries(), [refreshKey]);

  const deliveries = useMemo(() => (data || []).map((d) => ({ ...d, id: d.id || d._id })), [data]);
  const allDeliveries = useMemo(() => (all || []).map((d) => ({ ...d, id: d.id || d._id })), [all]);

  const count = (s) => allDeliveries.filter((x) => x.status === s).length;
  const active = allDeliveries.filter((x) => ['pending_accept', 'accepted', 'at_hub', 'in_transit', 'arrived'].includes(x.status)).length;

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    refetchAll();
    refetchMe();
  }, [refetchAll, refetchMe]);

  const setAvailability = async (value) => {
    try {
      await action.run(() => api.rider.availability({ status: value }));
      toast.success(`Availability → ${pickMeta(RIDER_AVAILABILITY_META, value).label}`);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const handleAction = async ({ delivery, action: a }) => {
    const id = delivery.id || delivery._id;
    if (a === 'complete') { setPodTarget(delivery); return; }
    if (a === 'fail') { setFailTarget(delivery); return; }
    if (a === 'reject') { setRejectTarget(delivery); return; }

    try {
      let fn;
      if (a === 'accept') fn = () => api.rider.accept(id);
      else if (a === 'arrive_hub') fn = () => api.rider.arriveHub(id);
      else if (a === 'depart') fn = () => api.rider.depart(id, { package_verified: true });
      else if (a === 'arrive') fn = () => api.rider.arrive(id);
      if (!fn) return;
      await action.run(fn);
      toast.success(actionMessage(a));
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Rider deliveries"
        description="Your assigned deliveries, accept offers, and the pickup-to-POD state machine."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh</Button>
            <Select className="w-56!" value={status} onChange={(e) => setStatus(e.target.value)}>
              {RIDER_STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </>
        }
      />

      <div className="mb-5 space-y-4">
        <AvailabilitySwitch value={availability} busy={action.busy} onChange={setAvailability} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Active" value={active} sub="assigned work" icon={Bike} tone="emerald" />
          <Stat label="Offers" value={count('pending_accept')} sub="awaiting accept" icon={Clock3} tone="amber" />
          <Stat label="At hub" value={count('accepted') + count('at_hub')} sub="pickup leg" icon={Truck} tone="violet" />
          <Stat label="In transit" value={count('in_transit') + count('arrived')} sub="delivery leg" icon={Truck} tone="sky" />
          <Stat label="Delivered" value={count('delivered')} sub="completed" icon={CheckCircle2} tone="emerald" />
        </div>
      </div>

      {loading && !data ? (
        <div className="card grid min-h-[260px] place-items-center p-6 text-sm text-slate-400">Loading deliveries…</div>
      ) : deliveries.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {deliveries.map((d) => (
            <DeliveryCard key={d.id} delivery={d} busy={action.busy} onAction={handleAction} />
          ))}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon={status === 'failed' || status === 'cancelled' ? AlertTriangle : Truck}
            title={status ? `No ${status.replaceAll('_', ' ')} deliveries` : 'No deliveries right now'}
            message={emptyMessage(status)}
            action={<Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh</Button>}
          />
        </div>
      )}

      {podTarget && <PodCaptureModal delivery={podTarget} onClose={() => setPodTarget(null)} onDone={refresh} />}
      {failTarget && <FailDeliveryModal delivery={failTarget} onClose={() => setFailTarget(null)} onDone={refresh} />}
      {rejectTarget && <RejectDeliveryModal delivery={rejectTarget} onClose={() => setRejectTarget(null)} onDone={refresh} />}
    </div>
  );
}

function actionMessage(action) {
  const map = {
    accept: 'Delivery accepted',
    arrive_hub: 'Arrived at hub',
    depart: 'Package verified — departed hub',
    arrive: 'Arrived at customer',
    complete: 'Delivered — POD captured',
    fail: 'Delivery failure recorded',
  };
  return map[action] || 'Action complete';
}
