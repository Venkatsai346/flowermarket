import { useState } from 'react';
import { Eye, Receipt, RefreshCw, Sparkles } from 'lucide-react';
import {
  bpsToPct,
  daysUntil,
  fmtDate,
  inr,
  periodLabel,
  pickMeta,
  signedInr,
  SUBSCRIPTION_STATUS_META,
} from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi, useAction } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
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

const INVOICE_LINE_LABEL = {
  subscription: 'Subscription',
  commission: 'Platform commission',
  adjustment: 'Adjustment',
};
const INVOICE_META = {
  draft: { label: 'Draft', tone: 'slate' },
  open: { label: 'Open', tone: 'sky' },
  paid: { label: 'Paid', tone: 'emerald' },
  overdue: { label: 'Overdue', tone: 'rose' },
  void: { label: 'Void', tone: 'slate' },
};

function InvoiceDetail({ invoiceId, onClose }) {
  const { data, loading } = useApi(() => api.marketplace.myInvoiceDetail(invoiceId), [invoiceId]);
  if (loading) return <Modal open onClose={onClose} title="Invoice"><LoadingBlock /></Modal>;
  const inv = data || {};
  return (
    <Modal open onClose={onClose} title={`Invoice ${inv.number || ''}`} subtitle={periodLabel(inv.period)}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge tone={INVOICE_META[inv.status]?.tone || 'slate'}>{INVOICE_META[inv.status]?.label || inv.status}</Badge>
          <p className="text-sm text-slate-500">Due {fmtDate(inv.dueAt)}</p>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Line</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(inv.lineItems || []).map((l, i) => (
                <tr key={i}>
                  <td className="px-3 py-2.5 text-slate-700">
                    {INVOICE_LINE_LABEL[l.type] || l.label || l.type}
                    <span className="block text-[11px] text-slate-400">{l.label}</span>
                  </td>
                  <td className={cn('px-3 py-2.5 text-right font-medium', l.type === 'adjustment' ? 'text-amber-600' : 'text-slate-800')}>
                    {l.type === 'adjustment' ? signedInr(l.amount) : inr(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between rounded-xl bg-slate-50 px-4 py-3 text-base font-bold text-slate-900">
          <span>Total</span><span>{inr(inv.total)}</span>
        </div>
        {inv.paymentRef && <p className="text-xs text-slate-400">Payment ref: {inv.paymentRef}</p>}
      </div>
    </Modal>
  );
}

export default function StoreBillingPage() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [plansOpen, setPlansOpen] = useState(false);
  const [limit] = useState(20);

  const store = useApi(() => api.marketplace.myStore(), []);
  const invoices = useApi(() => api.marketplace.myInvoices({ page, limit }), [page]);
  const plans = useApi(() => api.marketplace.plans(), []);

  const { busy: changing, run: runChange } = useAction();
  const [planCode, setPlanCode] = useState('');

  const sub = store.data?.subscription || null;
  const subMeta = sub ? pickMeta(SUBSCRIPTION_STATUS_META, sub.status) : null;
  const trialLeft = sub?.trialEndsAt ? daysUntil(sub.trialEndsAt) : null;

  const changePlan = async (code) => {
    if (!code) return;
    try {
      const r = await runChange(() => api.marketplace.changePlan(code));
      toast.success(r.data?.changed === false ? 'Already on this plan' : 'Plan changed — pro-rated from the next period');
      setPlansOpen(false);
      store.refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const canMarketplace = (p) => Boolean(p.features?.marketplaceEnabled);

  return (
    <div>
      <PageHeader
        title="Billing"
        description="Your subscription, plan changes and invoices."
        actions={
          <Button variant="secondary" icon={RefreshCw} onClick={() => { store.refetch(); invoices.refetch(); }}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* subscription card */}
        <Card className="lg:col-span-1">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Current plan</p>
              {sub ? (
                <>
                  <p className="mt-1 text-xl font-bold text-slate-900">{sub.planSnapshot?.name}</p>
                  <p className="text-sm text-slate-500">{inr(sub.planSnapshot?.priceMonthly)}/month</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-500">No active subscription</p>
              )}
            </div>
            {subMeta && <Badge tone={subMeta.tone} dot>{subMeta.label}</Badge>}
          </div>

          {sub && (
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Period</dt><dd className="font-medium text-slate-800">{periodLabel({ from: sub.periodStart, to: sub.periodEnd })}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Commission</dt><dd className="font-medium text-slate-800">{bpsToPct(sub.commissionRateBps)}</dd></div>
              {sub.trialEndsAt && (
                <div className="flex justify-between"><dt className="text-slate-500">Trial ends</dt><dd className="font-medium text-slate-800">{fmtDate(sub.trialEndsAt)}{trialLeft != null ? ` · ${trialLeft}d left` : ''}</dd></div>
              )}
              {sub.pendingAdjustment?.amount ? (
                <div className="flex justify-between text-amber-600"><dt>Next-period adjustment</dt><dd className="font-medium">{signedInr(sub.pendingAdjustment.amount)}</dd></div>
              ) : null}
            </dl>
          )}

          <Button className="mt-5 w-full" icon={Sparkles} onClick={() => { setPlanCode(sub?.planCode || ''); setPlansOpen(true); }}>
            {sub ? 'Change plan' : 'Choose a plan'}
          </Button>
        </Card>

        {/* invoices */}
        <Card title="Invoices" subtitle="Billed monthly per period" className="lg:col-span-2" bodyClassName="p-0!">
          <Table
            loading={invoices.loading && !invoices.data}
            data={invoices.data || []}
            onRowClick={(r) => setSelected(r.id)}
            empty={<EmptyState icon={Receipt} title="No invoices yet" message="Your first invoice appears when the billing cycle runs at the end of your period." />}
            columns={[
              { key: 'number', header: 'Number', render: (r) => <span className="font-mono text-xs font-medium text-slate-700">{r.number}</span> },
              { key: 'period', header: 'Period', render: (r) => <span className="text-xs text-slate-600">{periodLabel(r.period)}</span> },
              { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="font-semibold">{inr(r.total)}</span> },
              { key: 'status', header: 'Status', render: (r) => {
                const m = pickMeta({ draft: { label: 'Draft', tone: 'slate' }, open: { label: 'Open', tone: 'sky' }, paid: { label: 'Paid', tone: 'emerald' }, overdue: { label: 'Overdue', tone: 'rose' }, void: { label: 'Void', tone: 'slate' } }, r.status);
                return <Badge tone={m.tone}>{m.label}</Badge>;
              } },
              { key: 'dueAt', header: 'Due', render: (r) => fmtDate(r.dueAt) },
              { key: 'view', header: '', align: 'right', render: () => <Eye className="ml-auto h-4 w-4 text-slate-300" /> },
            ]}
            footer={<Pagination meta={invoices.meta} onPage={setPage} />}
          />
        </Card>
      </div>

      {/* change plan modal */}
      <Modal
        open={plansOpen}
        onClose={() => setPlansOpen(false)}
        title="Choose a plan"
        subtitle="Price change applies pro-rated from your next period."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPlansOpen(false)}>Cancel</Button>
            <Button loading={changing} disabled={!planCode} onClick={() => changePlan(planCode)}>Confirm change</Button>
          </>
        }
      >
        {plans.loading && !plans.data ? (
          <LoadingBlock />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {plans.data.map((p) => (
              <button
                key={p.code}
                type="button"
                onClick={() => setPlanCode(p.code)}
                className={cn(
                  'rounded-2xl border-2 bg-white p-4 text-left transition',
                  planCode === p.code ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-slate-200 hover:border-slate-300'
                )}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900">{p.name}</p>
                  {canMarketplace(p) && <Badge tone="violet">marketplace</Badge>}
                </div>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {inr(p.priceMonthly)}<span className="text-xs font-medium text-slate-400">/mo</span>
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {p.commissionRateBps ? `${bpsToPct(p.commissionRateBps)} commission` : 'No commission'}
                </p>
              </button>
            ))}
          </div>
        )}
      </Modal>

      {selected && <InvoiceDetail invoiceId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
