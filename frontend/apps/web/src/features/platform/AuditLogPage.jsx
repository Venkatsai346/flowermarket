import { useState } from 'react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { dayRange, fmtDate, compact } from '@flower-market/shared';
import Card from '../../components/ui/Card.jsx';
import Table from '../../components/ui/Table.jsx';
import FilterBar from '../../components/ui/FilterBar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { Shield } from 'lucide-react';

const ACTION_COLORS = {
  create: 'emerald',
  update: 'sky',
  delete: 'rose',
  approve: 'emerald',
  reject: 'rose',
  void: 'rose',
  pay: 'emerald',
  login: 'violet',
  logout: 'slate',
};

export default function AuditLogPage() {
  const [filters, setFilters] = useState({
    action: '',
    entity: '',
    actorRole: '',
    page: 1,
    limit: 50,
  });

  const { data, loading, error } = useApi(
    () => api.admin.auditLog?.(filters) || Promise.resolve({ items: [], meta: {} }),
    [filters],
  );

  const items = data?.items || [];
  const meta = data?.meta || {};

  const rows = items.map((entry) => ({
    id: entry.id || entry._id,
    date: fmtDate(entry.createdAt),
    actor: entry.actorName || entry.actorEmail || entry.actorId || '—',
    role: entry.actorRole || '—',
    action: entry.action || '—',
    entity: entry.entityType || '—',
    entityId: entry.entityId || '—',
    detail: entry.detail || entry.changes ? JSON.stringify(entry.changes || entry.detail).slice(0, 100) : '—',
    ip: entry.ip || '—',
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        subtitle="Platform-wide activity trail — every create, update, delete, approve, and payment."
      />

      <FilterBar
        filters={[
          { key: 'action', label: 'Action', type: 'select', options: ['', 'create', 'update', 'delete', 'approve', 'reject', 'pay', 'void', 'login'].map(v => ({ value: v, label: v || 'All' })) },
          { key: 'entity', label: 'Entity', type: 'select', options: ['', 'order', 'product', 'listing', 'user', 'tenant', 'invoice', 'payout', 'vendor'].map(v => ({ value: v, label: v || 'All' })) },
          { key: 'actorRole', label: 'Role', type: 'select', options: ['', 'super_admin', 'admin', 'vendor', 'rider', 'customer'].map(v => ({ value: v, label: v || 'All' })) },
        ]}
        values={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch, page: 1 }))}
      />

      <Card>
        {loading && !data ? (
          <LoadingBlock label="Loading audit log…" />
        ) : error ? (
          <EmptyState icon={Shield} title="Could not load audit log" message={error.message} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Shield} title="No audit entries" message="No activity matches your filters." />
        ) : (
          <>
            <Table
              columns={[
                { key: 'date', label: 'Date', width: '120px' },
                { key: 'actor', label: 'Actor' },
                { key: 'role', label: 'Role', width: '100px' },
                {
                  key: 'action',
                  label: 'Action',
                  width: '90px',
                  render: (v) => <Badge color={ACTION_COLORS[v] || 'slate'}>{v}</Badge>,
                },
                { key: 'entity', label: 'Entity', width: '100px' },
                { key: 'entityId', label: 'ID', width: '120px', mono: true },
                { key: 'detail', label: 'Detail', truncate: true },
                { key: 'ip', label: 'IP', width: '100px', mono: true },
              ]}
              rows={rows}
            />
            <Pagination
              page={filters.page}
              totalPages={meta.totalPages || 1}
              onChange={(page) => setFilters((f) => ({ ...f, page }))}
            />
          </>
        )}
      </Card>
    </div>
  );
}
