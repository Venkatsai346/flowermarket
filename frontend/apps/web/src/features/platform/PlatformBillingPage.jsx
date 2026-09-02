import { useState } from 'react';
import { Banknote, Eye, MoonStar, Play, Receipt, RefreshCw, XCircle } from 'lucide-react';
import {
  compact,
  fmtDate,
  inr,
  periodLabel,
  pickMeta,
  signedInr,
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
import { Select } from '../../components/ui/Field.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

const INVOICE_META = {
  draft: { label: 'Draft', tone: 'slate' },
  open: { label: 'Open', tone: 'sky' },
  paid: { label: 'Paid', tone: 'emerald' },
  overdue: { label: 'Overdue', tone: 'rose' },
  void: { label: 'Void', tone: 'slate' },
};
const LINE_LABEL = { subscription: 'Subscription', commission: 'Commission', adjustment: 'Adjustment' };

function InvoiceDetail({ invoice, onClose, onChanged }) {
  const { busy, run } = useAction();
  const act = async (kind) => {
    try {
      if (kind === 'pay') {
        const r = await run(() => api.marketplace.payInvoice(invoice.id));
        toast.success(`Invoice ${r.data?.invoice?.number || ''} marked paid`);
      } else {
        await run(() => api.marketplace.voidInvoice(invoice.id));
        toast.success('Invoice voided');
      }
      onClose();
      onChanged?.();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const pending = invoice.status === 'open' || invoice.status === 'draft';

  return (
    <Modal
      open
      onClose={onClose}
      title={`Invoice ${invoice.number || ''}`}
      subtitle={periodLabel(invoice.period)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {invoice.status === 'open' && (
            <Button variant="success" loading={busy} onClick={() => act('pay')} icon={Banknote}>
              Mark paid (mock)
            </Button>
          )}
          {pending && (
            <Button variant="danger" loading={busy} onClick={() => act('void')} icon={XCircle}>
              Void
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge tone={INVOICE_META[invoice.status]?.tone}>{INVOICE_META[invoice.status]?.label}</Badge>
          <p className="text-xs text-slate-500">Due {fmtDate(invoice.dueAt)} · tenant {invoice.tenantId?.slice(0, 8)}</p>
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
              {(invoice.lineItems || []).map((l, i) => (
                <tr key={i}>
                  <td className="px-3 py-2.5 text-slate-700">
                    {LINE_LABEL[l.type] || l.label || l.type}
                    {l.label && l.type !== l.label && <span className="block text-[11px] text-slate-400">{l.label}</span>}
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
          <span>Total</span><span>{inr(invoice.total)}</span>
        </div>
        {invoice.paymentRef && <p className="text-xs text-slate-400">Payment ref: {invoice.paymentRef} · paid {fmtDate(invoice.paidAt)}</p>}
      </div>
    </Modal>
  );
}

export default function PlatformBillingPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const { data, meta, loading, refetch } = useApi(
    () => api.marketplace.adminInvoices({ page, limit: 20, status: status || undefined }),
    [page, status]
  );
  const { busy, run } = useAction();
  const [running, setRunning] = useState('');

  const op = async (kind, label) => {
    setRunning(kind);
    try {
      let r;
      if (kind === 'cycle') r = await run(() => api.marketplace.runBillingCycle({}));
      else if (kind === 'sweep') r = await run(() => api.marketplace.overdueSweep());
      else if (kind === 'nightly') r = await run(() => api.marketplace.nightly({}));
      const d = r.data || {};
      toast.success(`${label} done — ${d.created != null ? `${d.created} invoices created, ` : ''}${d.scanned != null ? `${d.scanned} scanned` : ''}${d.overdue != null ? `, ${d.overdue} overdue` : ''}`);
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setRunning('');
    }
  };

  return (
    <div>
      <PageHeader
        title="Billing"
        description="Marketplace invoices, the billing cycle and mock payments."
        actions={
          <>
            <Button variant="secondary" icon={Play} loading={running === 'cycle'} onClick={() => op('cycle', 'Billing cycle')}>
              Run billing cycle
            </Button>
            <Button variant="secondary" icon={RefreshCw} loading={running === 'sweep'} onClick={() => op('sweep', 'Overdue sweep')}>
              Overdue sweep
            </Button>
            <Button variant="secondary" icon={MoonStar} loading={running === 'nightly'} onClick={() => op('nightly', 'Nightly pass')}>
              Nightly pass
            </Button>
          </>
        }
      />

      <Card bodyClassName="p-0!">
        <div className="border-b border-slate-100 px-4 py-3">
          <Select className="w-44!" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="void">Void</option>
          </Select>
        </div>
        <Table
          loading={loading && !data}
          data={data || []}
          onRowClick={(r) => setSelected(r)}
          empty={<EmptyState icon={Receipt} title="No invoices" message="Run the billing cycle to generate invoices for due periods." />}
          columns={[
            { key: 'number', header: 'Number', render: (r) => <span className="font-mono text-xs font-medium text-slate-700">{r.number}</span> },
            { key: 'tenant', header: 'Tenant', render: (r) => <span className="font-mono text-xs text-slate-500">{r.tenantId?.slice(0, 10)}…</span> },
            { key: 'period', header: 'Period', render: (r) => <span className="text-xs text-slate-600">{periodLabel(r.period)}</span> },
            { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="font-semibold">{inr(r.total)}</span> },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={INVOICE_META[r.status]?.tone}>{INVOICE_META[r.status]?.label}</Badge> },
            { key: 'dueAt', header: 'Due', render: (r) => fmtDate(r.dueAt) },
            { key: 'view', header: '', align: 'right', render: () => <Eye className="ml-auto h-4 w-4 text-slate-300" /> },
          ]}
          footer={<Pagination meta={meta} onPage={setPage} />}
        />
      </Card>

      {selected && <InvoiceDetail invoice={selected} onClose={() => setSelected(null)} onChanged={refetch} />}
    </div>
  );
}
