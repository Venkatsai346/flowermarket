import { BadgeIndianRupee, ReceiptText, Wallet as WalletIcon } from 'lucide-react';
import { fmtDateTime } from '@flower-market/shared';
import { api, useShopAuth } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { Button, Empty, Money, Skeleton } from '../components/ui.jsx';
import {
  REFUND_DESTINATION_META, REFUND_REASON_META, REFUND_STATUS_META,
  WALLET_TXN_REASON_META, meta, signedMoney,
} from '../lib/afterSales.js';

/**
 * Wallet page.
 *
 * The wallet is where most refunds land, so the page answers the two post-sale
 * questions in one place: "how much have I got?" and "where did it come from?".
 * Every number is the server's number — the UI does no arithmetic except a
 * sign glyph on the ledger, because a client rendering a wallet it computed
 * itself is how balances start disagreeing with the ledger.
 */
export default function Wallet() {
  const isAuth = useShopAuth((s) => s.isAuthenticated());
  const openAuth = useShop((s) => s.openAuth);

  const { data: wallet } = useApi(
    () => (isAuth ? api.shop.wallet() : Promise.resolve({ data: null })),
    [isAuth]
  );
  const { data: txns } = useApi(
    () => (isAuth ? api.shop.walletTransactions({ limit: 30 }) : Promise.resolve({ data: undefined })),
    [isAuth]
  );
  const { data: refunds } = useApi(
    () => (isAuth ? api.shop.walletRefunds({ limit: 30 }) : Promise.resolve({ data: undefined })),
    [isAuth]
  );

  if (!isAuth) {
    return (
      <div className="wrap py-16">
        <Empty
          icon={WalletIcon}
          title="Sign in to see your wallet"
          message="Wallet refunds are tied to your mobile number."
          action={<Button onClick={openAuth}>Sign in</Button>}
        />
      </div>
    );
  }

  const balance = Number(wallet?.balance) || 0;

  return (
    <div className="wrap py-8">
      <h1 className="mb-5 text-2xl font-bold tracking-tight text-slate-900">My wallet</h1>

      {/* balance */}
      <div className="card mb-6 flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Available balance</p>
          <p className="mt-1 flex items-baseline gap-2">
            <Money value={balance} className="text-3xl font-bold text-slate-900" />
            {balance > 0 && <span className="text-xs font-medium text-emerald-600">ready to use</span>}
          </p>
        </div>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--brand-soft)' }}>
          <BadgeIndianRupee className="h-7 w-7" style={{ color: 'var(--brand)' }} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* refunds */}
        <section className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900">
            <ReceiptText className="h-4 w-4 text-slate-400" /> Refunds
          </h2>
          {!refunds ? (
            <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
          ) : !refunds.length ? (
            <p className="py-6 text-center text-sm text-slate-400">No refunds yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {refunds.map((r) => {
                const status = meta(r.status, REFUND_STATUS_META);
                const destination = REFUND_DESTINATION_META[r.destination]?.short || r.destination || 'Wallet';
                return (
                  <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{REFUND_REASON_META[r.reason] || r.reason || 'Refund'}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {destination}{r.createdAt && ` · ${fmtDateTime(r.createdAt)}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Money value={r.amount} className="text-sm font-bold text-emerald-600" />
                      <p className="text-[11px] font-medium text-slate-400">{status.label}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ledger */}
        <section className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900">
            <WalletIcon className="h-4 w-4 text-slate-400" /> Wallet activity
          </h2>
          {!txns ? (
            <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
          ) : !txns.length ? (
            <p className="py-6 text-center text-sm text-slate-400">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {txns.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{WALLET_TXN_REASON_META[t.reason] || t.reason || 'Transaction'}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {t.createdAt && fmtDateTime(t.createdAt)}
                      {t.balanceAfter != null && ` · balance ₹${Number(t.balanceAfter).toLocaleString('en-IN')}`}
                    </p>
                  </div>
                  <span className={t.type === 'debit' ? 'shrink-0 text-sm font-bold text-slate-600' : 'shrink-0 text-sm font-bold text-emerald-600'}>
                    {signedMoney(t.amount, t.type)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
