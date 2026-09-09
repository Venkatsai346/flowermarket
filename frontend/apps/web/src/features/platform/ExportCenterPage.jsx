import { useState } from 'react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { fmtDate } from '@flower-market/shared';
import Card from '../../components/ui/Card.jsx';
import Table from '../../components/ui/Table.jsx';
import FilterBar from '../../components/ui/FilterBar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { Download, FileSpreadsheet, RefreshCw, Trash2 } from 'lucide-react';

const STATUS_COLORS = {
  pending: 'slate',
  running: 'sky',
  completed: 'emerald',
  failed: 'rose',
  scheduled: 'violet',
};

/**
 * Export Download Center — manage all CSV/data exports.
 * Shows scheduled exports, lets admins trigger ad-hoc exports, and download results.
 */
export default function ExportCenterPage() {
  const [filters, setFilters] = useState({ status: '', page: 1, limit: 20 });
  const [creating, setCreating] = useState(false);

  const { data, loading, refetch } = useApi(
    () => api.admin.exports(filters),
    [filters],
  );

  const items = data?.items || data || [];
  const meta = data?.meta || {};

  const triggerExport = async (kind) => {
    setCreating(true);
    try {
      await api.admin.createExport({ kind });
      refetch();
    } catch {
      // handled by error boundary
    } finally {
      setCreating(false);
    }
  };

  const runExport = async (id) => {
    try {
      await api.admin.runExport(id);
      refetch();
    } catch { /* noop */ }
  };

  const downloadExport = async (id, name) => {
    try {
      await api.admin.downloadExport(id);
    } catch { /* noop */ }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Export Center"
        subtitle="Download CSV exports for products, orders, inventory, analytics, and more."
        actions={
          <div className="flex gap-2">
            <Button size="sm" loading={creating} onClick={() => triggerExport('products')}>Export Products</Button>
            <Button size="sm" variant="secondary" loading={creating} onClick={() => triggerExport('orders')}>Export Orders</Button>
            <Button size="sm" variant="secondary" loading={creating} onClick={() => triggerExport('inventory')}>Export Inventory</Button>
          </div>
        }
      />

      <FilterBar
        filters={[
          { key: 'status', label: 'Status', type: 'select', options: [
            { value: '', label: 'All' },
            { value: 'pending', label: 'Pending' },
            { value: 'running', label: 'Running' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' },
          ]},
        ]}
        values={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch, page: 1 }))}
      />

      <Card>
        {loading && !data ? (
          <LoadingBlock label="Loading exports…" />
        ) : items.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="No exports yet" message="Trigger an export above to get started." />
        ) : (
          <>
            <Table
              columns={[
                { key: 'kind', label: 'Type', width: '120px', render: (v) => <Badge color="sky">{v}</Badge> },
                { key: 'status', label: 'Status', width: '100px', render: (v) => <Badge color={STATUS_COLORS[v] || 'slate'}>{v}</Badge> },
                { key: 'createdAt', label: 'Created', width: '140px', render: (v) => fmtDate(v) },
                { key: 'rowCount', label: 'Rows', width: '80px', render: (v) => v ?? '—' },
                { key: 'fileSize', label: 'Size', width: '80px', render: (v) => v ? `${(v / 1024).toFixed(1)} KB` : '—' },
                {
                  key: 'actions',
                  label: '',
                  width: '120px',
                  render: (_, row) => (
                    <div className="flex gap-1">
                      {row.status === 'completed' && (
                        <button
                          type="button"
                          onClick={() => downloadExport(row.id || row._id, row.kind)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      )}
                      {(row.status === 'pending' || row.status === 'failed') && (
                        <button
                          type="button"
                          onClick={() => runExport(row.id || row._id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-sky-50 hover:text-sky-600"
                          title="Run now"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ),
                },
              ]}
              rows={items}
            />
            {meta.totalPages > 1 && (
              <Pagination
                page={filters.page}
                totalPages={meta.totalPages}
                onChange={(page) => setFilters((f) => ({ ...f, page }))}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
