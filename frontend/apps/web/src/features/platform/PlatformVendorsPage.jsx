import { useState } from 'react';
import { Check, Truck, X } from 'lucide-react';
import {
  bpsToPct,
  fmtDate,
  num,
  pickMeta,
  PRODUCT_MASTER_STATUS_META,
  VENDOR_STATUS_META,
} from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Modal from '../../components/ui/Modal.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';

function VendorDetail({ vendorId, onClose, onChanged }) {
  const { data, loading, refetch } = useApi(() => api.marketplace.adminVendorDetail(vendorId), [vendorId]);
  const { busy, run } = useAction();

  if (loading && !data) return <Modal open onClose={onClose} title="Vendor"><LoadingBlock /></Modal>;
  const v = data || {};
  const products = v.products || [];

  const review = async (productId, decision) => {
    try {
      await run(() => api.marketplace.reviewVendorProduct(productId, { decision }));
      toast.success(decision === 'approve' ? 'Product approved & listed for marketplace' : 'Product rejected');
      refetch();
      onChanged?.();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Modal open onClose={onClose} title={v.businessName} subtitle={`@${v.slug} · ${v.city || '—'}`} size="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3.5">
            <p className="text-[11px] font-semibold uppercase text-slate-400">Status</p>
            <div className="mt-1">
              <Badge tone={pickMeta(VENDOR_STATUS_META, v.status).tone} dot>{pickMeta(VENDOR_STATUS_META, v.status).label}</Badge>
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5">
            <p className="text-[11px] font-semibold uppercase text-slate-400">GMV</p>
            <p className="mt-0.5 text-sm font-bold text-slate-800">{v.stats ? `₹${num(v.stats.gmv)}` : '—'}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5">
            <p className="text-[11px] font-semibold uppercase text-slate-400">Orders</p>
            <p className="mt-0.5 text-sm font-bold text-slate-800">{num(v.stats?.orders)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5">
            <p className="text-[11px] font-semibold uppercase text-slate-400">Commission</p>
            <p className="mt-0.5 text-sm font-bold text-slate-800">{bpsToPct(v.stats?.commissionRateBps ?? v.commissionRateBps)}</p>
          </div>
        </div>

        <div>
          <p className="label">Products ({products.length})</p>
          {products.length ? (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">SKU</th>
                    <th className="px-3 py-2 font-semibold">Title</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Listed</th>
                    <th className="px-3 py-2 text-right font-semibold">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.skuGlobal}</td>
                      <td className="px-3 py-2 text-slate-800">{p.title}</td>
                      <td className="px-3 py-2">
                        <Badge tone={pickMeta(PRODUCT_MASTER_STATUS_META, p.status).tone}>
                          {pickMeta(PRODUCT_MASTER_STATUS_META, p.status).label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{p.marketplaceListed ? 'Yes' : '—'}</td>
                      <td className="px-3 py-2">
                        {p.status === 'pending_review' || p.status === 'pending' ? (
                          <div className="flex justify-end gap-1.5">
                            <button className="btn-success btn-sm" disabled={busy} onClick={() => review(p.id, 'approve')}>
                              <Check className="h-3.5 w-3.5" /> Approve
                            </button>
                            <button className="btn-danger btn-sm" disabled={busy} onClick={() => review(p.id, 'reject')}>
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="block text-right text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">No products yet.</p>
          )}
          {products.some((p) => p.status === 'pending') && (
            <p className="mt-2 text-xs text-slate-400">
              Approving a product sets <b>marketplaceListed = true</b> — marketplace-enabled stores can then sync it.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
          <p><b className="text-slate-700">GSTIN:</b> {v.gstin || '—'}</p>
          <p><b className="text-slate-700">Joined:</b> {fmtDate(v.joinedAt)}</p>
          <p><b className="text-slate-700">Payout:</b> {v.payout?.method ? `${v.payout.method.toUpperCase()} · ${v.payout.name || ''} ${v.payout.maskedAccount || ''}` : '—'}</p>
          <p><b className="text-slate-700">Categories:</b> {(v.categories || []).join(', ') || '—'}</p>
        </div>
      </div>
    </Modal>
  );
}

export default function PlatformVendorsPage() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const { data, meta, loading, refetch } = useApi(
    () => api.marketplace.adminVendors({ page, limit: 20 }),
    [page]
  );

  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Approved sellers on the marketplace — commissions, health and product review."
      />
      <Card bodyClassName="p-0!">
        <Table
          loading={loading && !data}
          data={data || []}
          onRowClick={(r) => setSelected(r.id)}
          empty={<EmptyState icon={Truck} title="No vendors yet" message="Approve vendor applications to onboard sellers." />}
          columns={[
            { key: 'business', header: 'Vendor', render: (r) => (
              <div>
                <p className="font-medium text-slate-800">{r.businessName}</p>
                <p className="text-[11px] text-slate-400">@{r.slug} · {r.city || ''}</p>
              </div>
            ) },
            { key: 'status', header: 'Status', render: (r) => {
              const m = pickMeta(VENDOR_STATUS_META, r.status);
              return <Badge tone={m.tone} dot>{m.label}</Badge>;
            } },
            { key: 'commission', header: 'Commission', render: (r) => <span className="font-mono text-xs">{bpsToPct(r.commissionRateBps)}</span> },
            { key: 'counters', header: 'GMV / Orders', render: (r) => (
              <span className="text-xs text-slate-600">
                ₹{num(r.counters?.gmv ?? 0)} / {num(r.counters?.orders ?? 0)}
              </span>
            ) },
            { key: 'joinedAt', header: 'Joined', render: (r) => fmtDate(r.joinedAt) },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>
      {selected && <VendorDetail vendorId={selected} onClose={() => setSelected(null)} onChanged={refetch} />}
    </div>
  );
}
