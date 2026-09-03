import { useState } from 'react';
import { CalendarDays, MapPin, Plus, Power, RefreshCw, Store } from 'lucide-react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { cn, errMsg, rid } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import HubFormModal from './HubFormModal.jsx';
import PincodeEditorModal from './PincodeEditorModal.jsx';
import SlotsPanel from './SlotsPanel.jsx';

export default function HubsPage() {
  const [tab, setTab] = useState('hubs');
  const [refreshKey, setRefreshKey] = useState(0);
  const [formHub, setFormHub] = useState(null);
  const [pincodeHub, setPincodeHub] = useState(null);
  const [slotsHub, setSlotsHub] = useState('');
  const { data: hubs, loading, error, refetch } = useApi(() => api.admin.hubs(), [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);
  const toggle = async (hub) => {
    try {
      await api.admin.toggleHub(hub.id || hub._id, { isActive: !hub.isActive });
      toast.success(hub.isActive ? 'Hub deactivated' : 'Hub activated');
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const rows = hubs || [];

  return (
    <div>
      <PageHeader
        title="Hubs & slots"
        description="Dark stores, service areas and delivery-slot capacity."
        actions={
          <>
            {tab === 'hubs' && <Button variant="primary" icon={Plus} onClick={() => setFormHub({})}>Create hub</Button>}
            <Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh</Button>
          </>
        }
      />

      <nav className="mb-5 flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1.5">
        {[['hubs', 'Hubs'], ['slots', 'Slots']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
              tab === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100',
            )}
          >
            {key === 'hubs' ? <Store className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
            {label}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div>
            <p className="text-sm font-semibold text-rose-700">Couldn’t load hubs</p>
            <p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refetch}>Retry</Button>
        </div>
      ) : tab === 'slots' ? (
        <SlotsPanel hubs={rows} hubId={slotsHub} onHubChange={setSlotsHub} />
      ) : loading && !rows.length ? (
        <LoadingBlock />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((hub) => (
            <Card key={rid(hub)} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{hub.name}</p>
                  <p className="font-mono text-xs text-slate-400">{hub.code}</p>
                </div>
                <Badge tone={hub.isActive ? 'emerald' : 'slate'} dot>{hub.isActive ? 'Active' : 'Inactive'}</Badge>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                {hub.address?.line1}{hub.address?.city ? `, ${hub.address.city}` : ''}{hub.address?.state ? `, ${hub.address.state}` : ''}
                {hub.address?.pincode ? ` · ${hub.address.pincode}` : ''}
              </p>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-slate-500">Default capacity</span>
                <span className="text-sm font-bold text-slate-900">{hub.defaultSlotCapacity ?? 25}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-xs text-slate-500">Service pincodes</span>
                <span className="text-sm font-semibold text-slate-700">{hub.serviceablePincodes?.length ?? 0}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {(hub.serviceablePincodes || []).slice(0, 6).map((p) => <Badge key={p} tone="sky" className="font-mono">{p}</Badge>)}
                {(hub.serviceablePincodes || []).length > 6 && <Badge tone="sky">+{hub.serviceablePincodes.length - 6}</Badge>}
                {!hub.serviceablePincodes?.length && <span className="text-xs text-slate-400">No pincodes configured</span>}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 pt-2">
                <Button variant="secondary" size="sm" icon={CalendarDays} onClick={() => { setSlotsHub(rid(hub)); setTab('slots'); }}>Slots</Button>
                <Button variant="secondary" size="sm" icon={MapPin} onClick={() => setPincodeHub(hub)}>Pincodes</Button>
                <Button variant="secondary" size="sm" onClick={() => setFormHub(hub)}>Edit</Button>
                <Button variant="ghost" size="sm" icon={Power} onClick={() => toggle(hub)}>{hub.isActive ? 'Deactivate' : 'Activate'}</Button>
              </div>
            </Card>
          ))}
          {!rows.length && <div className="md:col-span-2 xl:col-span-3"><EmptyState icon={Store} title="No hubs yet" message="Create the first dark store to start slicing delivery slots." /></div>}
        </div>
      )}

      {formHub && <HubFormModal hub={formHub.id || formHub._id ? formHub : null} onClose={() => { setFormHub(null); refresh(); }} />}
      {pincodeHub && <PincodeEditorModal hub={pincodeHub} onClose={() => { setPincodeHub(null); refresh(); }} />}
    </div>
  );
}
