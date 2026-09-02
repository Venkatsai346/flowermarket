import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Link2, RefreshCw, Store, Truck, Users } from 'lucide-react';
import { bpsToPct, num } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';

const asList = (d) => (Array.isArray(d) ? d : d?.items || []);

export default function StoreVendorsPage() {
  const store = useApi(() => api.marketplace.myStore(), []);
  const vendors = useApi(() => api.marketplace.storeVendors(), []);
  const { busy, run } = useAction();
  const [syncingId, setSyncingId] = useState(null);
  const [vendorId, setVendorId] = useState('');

  const tenant = store.data?.tenant || null;
  const marketplaceEnabled = Boolean(tenant?.features?.marketplaceEnabled);
  const list = asList(vendors.data);

  const sync = async (vendorId) => {
    setSyncingId(vendorId);
    try {
      const r = await run(() => api.marketplace.syncVendorProducts(vendorId));
      const { created = 0, skipped = 0 } = r.data || {};
      toast.success(`Sync complete — ${created} added, ${skipped} already in store`);
      vendors.refetch();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Marketplace vendors whose approved products can be sold in your store."
        actions={!vendors.loading ? <Button variant="secondary" icon={RefreshCw} onClick={vendors.refetch}>Refresh</Button> : null}
      />

      {!marketplaceEnabled && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5">
          <p className="flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            <b>Marketplace mode is off.</b> Upgrade to a marketplace plan in Billing to sync vendor products into your catalog.
          </p>
          <Link to="/billing"><Button size="sm">Go to billing</Button></Link>
        </div>
      )}

      {marketplaceEnabled && (
        <Card className="mb-5 !border-dashed">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[260px] flex-1">
              <Field
                label="Connect a marketplace vendor"
                hint="Vendor id from the platform's vendor registry (or the vendor's public handle)."
              >
                <Input
                  className="font-mono text-xs"
                  placeholder="vendor id…"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                />
              </Field>
            </div>
            <Button
              variant="secondary"
              icon={Link2}
              disabled={!vendorId.trim() || busy}
              loading={syncingId === '__new' || busy}
              onClick={async () => {
                setSyncingId('__new');
                try {
                  const r = await run(() => api.marketplace.syncVendorProducts(vendorId.trim()));
                  const { created = 0, skipped = 0 } = r.data || {};
                  toast.success(`Connected — ${created} product(s) added, ${skipped} already present`);
                  setVendorId('');
                  vendors.refetch();
                } catch (err) {
                  toast.error(errMsg(err));
                } finally {
                  setSyncingId(null);
                }
              }}
            >
              Connect vendor
            </Button>
          </div>
        </Card>
      )}

      {vendors.loading && !vendors.data ? (
        <Card><p className="py-10 text-center text-sm text-slate-400">Loading vendors…</p></Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={Truck}
            title="No vendors connected yet"
            message={
              marketplaceEnabled
                ? 'Use “Connect a marketplace vendor” above to pull an approved vendor’s products into your catalog (idempotent — safe to re-run).'
                : 'Enable marketplace mode (Billing → choose a marketplace plan) to start selling vendor products.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((v) => (
            <Card key={v.id} className="p-0!">
              <div className="flex items-start justify-between gap-3 p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                    <Store className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">{v.businessName}</p>
                    <p className="text-xs text-slate-500">@{v.slug} · {v.city || '—'}</p>
                  </div>
                </div>
                <Badge tone={v.status === 'suspended' ? 'rose' : 'emerald'}>{v.status}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-slate-100 px-5 py-3.5 text-center">
                <div>
                  <p className="text-sm font-bold text-slate-900">{num(v.counters?.gmv ?? 0)}</p>
                  <p className="text-[11px] text-slate-400">GMV</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">{num(v.counters?.orders ?? 0)}</p>
                  <p className="text-[11px] text-slate-400">Orders</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">{bpsToPct(v.commissionRateBps)}</p>
                  <p className="text-[11px] text-slate-400">Commission</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                <p className="text-xs text-slate-500">
                  {(v.categories || []).slice(0, 3).join(' · ') || 'No categories'}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={syncingId === v.id || busy}
                  icon={RefreshCw}
                  disabled={!marketplaceEnabled}
                  onClick={() => sync(v.id)}
                >
                  Sync products
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {marketplaceEnabled && list.length > 0 && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
          <Users className="h-3.5 w-3.5" /> Sync is idempotent — re-syncing never duplicates listings.
        </p>
      )}
    </div>
  );
}
