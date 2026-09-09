import { useState } from 'react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { fmtDate, inr } from '@flower-market/shared';
import Card from '../../components/ui/Card.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Field from '../../components/ui/Field.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { Landmark, RotateCcw, Send } from 'lucide-react';

/**
 * Statutory Deposits UI — manage TCS/TDS deposits to government.
 * Super admin can record a deposit, view history, and revert if needed.
 */
export default function StatutoryDepositsPage() {
  const [depositOpen, setDepositOpen] = useState(false);
  const [revertId, setRevertId] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, refetch } = useApi(
    () => api.payouts.admin.statutoryDeposits?.({ limit: 50 }) || Promise.resolve({ items: [] }),
    [],
  );

  const items = data?.items || data || [];

  const [form, setForm] = useState({ statute: 'tds', amount: '', utr: '', reference: '', period: '' });

  const submitDeposit = async () => {
    setBusy(true);
    try {
      await api.payouts.admin.statutoryDeposit({
        statute: form.statute,
        amountPaise: Math.round(Number(form.amount) * 100),
        utr: form.utr,
        reference: form.reference,
        period: form.period,
      });
      setDepositOpen(false);
      setForm({ statute: 'tds', amount: '', utr: '', reference: '', period: '' });
      refetch();
    } catch { /* noop */ } finally {
      setBusy(false);
    }
  };

  const revertDeposit = async () => {
    if (!revertId) return;
    setBusy(true);
    try {
      await api.payouts.admin.revertStatutoryDeposit?.(revertId) ||
        await api.payouts.admin.statutoryDeposit({ revert: true, depositId: revertId });
      setRevertId(null);
      refetch();
    } catch { /* noop */ } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statutory Deposits"
        subtitle="Record TCS/TDS deposits to government and track deposit history."
        actions={<Button size="sm" icon={Send} onClick={() => setDepositOpen(true)}>Record Deposit</Button>}
      />

      <Card>
        {loading ? (
          <LoadingBlock />
        ) : items.length === 0 ? (
          <EmptyState icon={Landmark} title="No deposits recorded" message="Record a TCS/TDS deposit to get started." />
        ) : (
          <Table
            columns={[
              { key: 'statute', label: 'Type', width: '80px', render: (v) => <Badge color={v === 'tds' ? 'violet' : 'sky'}>{v?.toUpperCase()}</Badge> },
              { key: 'amountPaise', label: 'Amount', width: '120px', render: (v) => inr((v || 0) / 100) },
              { key: 'utr', label: 'UTR', width: '140px', mono: true },
              { key: 'reference', label: 'Reference', width: '120px' },
              { key: 'period', label: 'Period', width: '100px' },
              { key: 'createdAt', label: 'Date', width: '120px', render: (v) => fmtDate(v) },
              { key: 'status', label: 'Status', width: '100px', render: (v) => <Badge color={v === 'reverted' ? 'rose' : 'emerald'}>{v || 'active'}</Badge> },
              {
                key: 'actions',
                label: '',
                width: '60px',
                render: (_, row) => row.status !== 'reverted' ? (
                  <button
                    type="button"
                    onClick={() => setRevertId(row.id || row._id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Revert deposit"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                ) : null,
              },
            ]}
            rows={items}
          />
        )}
      </Card>

      {/* Deposit modal */}
      <Modal open={depositOpen} onClose={() => setDepositOpen(false)} title="Record Statutory Deposit">
        <div className="space-y-4 p-4">
          <Field label="Statute" required>
            <select value={form.statute} onChange={(e) => setForm({ ...form, statute: e.target.value })} className="input">
              <option value="tds">TDS</option>
              <option value="tcs">TCS</option>
            </select>
          </Field>
          <Field label="Amount (₹)" required>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" min="0" step="0.01" />
          </Field>
          <Field label="UTR Number" required>
            <input value={form.utr} onChange={(e) => setForm({ ...form, utr: e.target.value })} className="input" placeholder="Bank transaction reference" />
          </Field>
          <Field label="Challan Reference">
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="input" placeholder="Challan number (optional)" />
          </Field>
          <Field label="Period">
            <input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} className="input" placeholder="e.g. Q1 FY2025-26" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDepositOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submitDeposit}>Record Deposit</Button>
          </div>
        </div>
      </Modal>

      {/* Revert confirmation */}
      <Modal open={!!revertId} onClose={() => setRevertId(null)} title="Revert Deposit">
        <div className="space-y-4 p-4">
          <p className="text-sm text-slate-600">
            Are you sure you want to revert this deposit? This will reverse the ledger entry.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRevertId(null)}>Cancel</Button>
            <Button variant="outline" className="!text-rose-600 !border-rose-200" loading={busy} onClick={revertDeposit}>Revert</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
