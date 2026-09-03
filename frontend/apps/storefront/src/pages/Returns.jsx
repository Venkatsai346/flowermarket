import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { fmtDateTime } from '@flower-market/shared';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { useShopAuth } from '../api.js';
import { Button, Empty, Money, Skeleton } from '../components/ui.jsx';
import { RETURN_CLAIM_META, RETURN_STATUS_META, meta } from '../lib/afterSales.js';
import { cn, errMsg } from '../lib/utils.js';

/**
 * Returns — "what did I send back, and what happened to it?".
 *
 * Copy is deliberately outcome-first: each row says the item decision
 * (approved / collected / refunded) and the money, because that is the only
 * question a customer actually has. Operational detail stays a tap away (the
 * server's `returnDetail`), not on the row.
 */
export default function Returns() {
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const openAuth = useShop((s) => s.openAuth);
  const toast = useShop((s) => s.toast);
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState(() => new Map());
  const [loadingDetail, setLoadingDetail] = useState(null);

  const { data, loading } = useApi(() => (isAuth ? api.shop.returns({ limit: 30 }) : Promise.resolve({ data: undefined })), [isAuth]);

  if (!isAuth) {
    return (
      <div className="wrap py-16">
        <Empty
          icon={RotateCcw}
          title="Sign in to see returns"
          message="Your returns and refunds are tied to your mobile number."
          action={<Button onClick={openAuth}>Sign in</Button>}
        />
      </div>
    );
  }

  const toggleDetail = async (id) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!details.has(id)) {
      setLoadingDetail(id);
      try {
        const r = await api.shop.returnDetail(id);
        setDetails((s) => {
          const next = new Map(s);
          next.set(id, r.data);
          return next;
        });
      } catch (e) {
        toast(errMsg(e), 'error');
      } finally {
        setLoadingDetail(null);
      }
    }
  };

  return (
    <div className="wrap py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Returns &amp; refunds</h1>
        <p className="mt-1 max-w-xl text-sm text-slate-500">
          Every return request you've made for this store, in one place.
        </p>
      </div>

      {loading && !data ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}</div>
      ) : !data?.length ? (
        <Empty
          icon={RotateCcw}
          title="No returns yet"
          message="If anything needs to go back, you can start it from a delivered order."
          action={<Link to="/orders"><Button variant="soft">View my orders</Button></Link>}
        />
      ) : (
        <ul className="space-y-3">
          {data.map((r) => {
            const claim = RETURN_CLAIM_META[r.claimType] || { label: r.claimType, short: r.claimType };
            const status = meta(r.status, RETURN_STATUS_META);
            const detail = details.get(r.id);
            const expanded = openId === r.id;
            const loadingD = loadingDetail === r.id;
            return (
              <li key={r.id} className="card overflow-hidden">
                <div className="flex items-center gap-4 p-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
                    style={{ background: 'var(--brand-soft)' }}>
                    <RotateCcw className="h-5 w-5" style={{ color: 'var(--brand)' }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{claim.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.tone}`}>{status.label}</span>
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {r.reason || r.reasonCode || 'Return'}
                      {r.createdAt && ` · ${fmtDateTime(r.createdAt)}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {r.refundAmount > 0 && <Money value={r.refundAmount} className="text-sm font-bold text-slate-900" />}
                    <div className="mt-1 flex items-center justify-end gap-2">
                      <Link to={`/orders/${r.orderId}`} className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline">View order</Link>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => toggleDetail(r.id)}
                        className="flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-700"
                      >
                        {expanded ? 'Hide' : 'Details'}
                        <ChevronDown className={cn('h-3.5 w-3.5 transition', expanded && 'rotate-180')} />
                      </button>
                    </div>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4">
                    {loadingD ? (
                      <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>
                    ) : (
                      <div className="space-y-4">
                        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                          {(detail?.items || []).map((it) => (
                            <li key={it.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-slate-800">{it.qty} item{it.qty === 1 ? '' : 's'}</p>
                                {it.qcStatus && <p className="text-xs text-slate-400">{meta(it.qcStatus, QC_META).label}</p>}
                              </div>
                              <Money value={it.refundAmount} className="shrink-0 font-semibold text-slate-800" />
                            </li>
                          ))}
                        </ul>
                        {detail?.returnRequest && (
                          <dl className="grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                            {detail.returnRequest.createdAt && <div><dt className="font-semibold text-slate-400">Requested</dt><dd>{fmtDateTime(detail.returnRequest.createdAt)}</dd></div>}
                            {detail.returnRequest.pickedUpAt && <div><dt className="font-semibold text-slate-400">Collected</dt><dd>{fmtDateTime(detail.returnRequest.pickedUpAt)}</dd></div>}
                            {detail.returnRequest.qcCompletedAt && <div><dt className="font-semibold text-slate-400">QC</dt><dd>{fmtDateTime(detail.returnRequest.qcCompletedAt)}</dd></div>}
                          </dl>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** QC outcome vocabulary (backend `RETURN_QC_STATUS`). */
const QC_META = {
  pending: { label: 'Quality check pending', tone: 'text-slate-400' },
  passed: { label: 'Passed quality check', tone: 'text-emerald-600' },
  failed: { label: 'Failed quality check', tone: 'text-rose-600' },
};
