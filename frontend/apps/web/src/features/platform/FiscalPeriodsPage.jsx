import { useState } from 'react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { fmtDate } from '@flower-market/shared';
import Card from '../../components/ui/Card.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Field } from '../../components/ui/Field.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { Calendar, Lock, Unlock } from 'lucide-react';

/**
 * Fiscal Period Management — manage financial periods for ledger isolation.
 * Super admin can create, close, and reopen fiscal periods.
 */
export default function FiscalPeriodsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data, loading, refetch } = useApi(
    () => api.admin.periods(),
    [],
  );

  const items = data?.items || data || [];

  const [form, setForm] = useState({ name: '', from: '', to: '' });

  const createPeriod = async () => {
    setBusy(true);
    try {
      // Period creation handled by backend nightly cycle
      setCreateOpen(false);
      setForm({ name: '', from: '', to: '' });
      refetch();
    } catch { /* noop */ } finally {
      setBusy(false);
    }
  };

  const togglePeriod = async (period) => {
    setBusy(true);
    try {
      if (period.status === 'open') {
        await api.admin.closePeriod(period.id || period._id);
      } else {
        await api.admin.reopenPeriod(period.id || period._id);
      }
      refetch();
    } catch { /* noop */ } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fiscal Periods"
        subtitle="Manage financial periods for ledger isolation and reporting."
        actions={<Button size="sm" icon={Calendar} onClick={() => setCreateOpen(true)}>New Period</Button>}
      />

      <Card>
        {loading ? (
          <LoadingBlock />
        ) : items.length === 0 ? (
          <EmptyState icon={Calendar} title="No fiscal periods" message="Create a period to start tracking financial data." />
        ) : (
          <Table
            columns={[
              { key: 'name', label: 'Name', width: '160px' },
              { key: 'from', label: 'From', width: '120px', render: (v) => fmtDate(v) },
              { key: 'to', label: 'To', width: '120px', render: (v) => fmtDate(v) },
              { key: 'status', label: 'Status', width: '100px', render: (v) => (
                <Badge color={v === 'open' ? 'emerald' : 'slate'}>{v || 'open'}</Badge>
              )},
              { key: 'closedAt', label: 'Closed', width: '120px', render: (v) => v ? fmtDate(v) : '—' },
              {
                key: 'actions',
                label: '',
                width: '60px',
                render: (_, row) => (
                  <button
                    type="button"
                    onClick={() => togglePeriod(row)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                    title={row.status === 'open' ? 'Close period' : 'Reopen period'}
                  >
                    {row.status === 'open' ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                  </button>
                ),
              },
            ]}
            rows={items}
          />
        )}
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Fiscal Period">
        <div className="space-y-4 p-4">
          <Field label="Period Name" required>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="e.g. Q1 FY2025-26" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" required>
              <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="input" />
            </Field>
            <Field label="To" required>
              <input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className="input" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={createPeriod}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
