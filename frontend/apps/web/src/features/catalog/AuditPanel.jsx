import { useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { fmtDateTime, pickMeta } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Field, Input, Select } from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Table from '../../components/ui/Table.jsx';
import { AUDIT_ACTION_META, changedKeys, entityLabel, fmtJson } from './catalogMeta.js';

const ACTIONS = Object.entries(AUDIT_ACTION_META);
const ENTITIES = [
  'product_master', 'product_change_request', 'tenant_product', 'product_variant',
  'product_image', 'product_attribute', 'inventory', 'hub', 'delivery_slot', 'user', 'order', 'payout',
];

export default function AuditPanel() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState(null);

  const validActor = /^[0-9a-fA-F]{24}$/.test(actorId) ? actorId : undefined;
  const { data, meta, loading, error, refetch } = useApi(
    () => api.catalogAdmin.audit({
      page, limit: 20,
      entityType: entityType || undefined,
      action: action || undefined,
      actorId: validActor,
      from: from ? new Date(`${from}T00:00:00Z`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59Z`).toISOString() : undefined,
    }),
    [page, entityType, action, validActor, from, to, refreshKey],
  );

  const refresh = () => setRefreshKey((k) => k + 1);
  const rows = (data || []).map((r) => ({ ...r, id: r.id || r._id || r.entityId }));

  return (
    <div className="space-y-4">
      {error && !data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div><p className="text-sm font-semibold text-rose-700">Couldn’t load the audit trail</p><p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p></div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>
        </div>
      ) : (
        <Card
          title="Catalog audit trail"
          subtitle="Immutable, append-only operator + tenant history across the catalog."
          bodyClassName="p-0!"
          actions={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh}>Refresh</Button>}
        >
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
            <Select className="w-52!" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
              <option value="">All entity types</option>
              {ENTITIES.map((t) => <option key={t} value={t}>{entityLabel(t)}</option>)}
            </Select>
            <Select className="w-44!" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
              <option value="">All actions</option>
              {ACTIONS.map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
            </Select>
            <Field label="Actor id">
              <Input className="w-56!" value={actorId} onChange={(e) => { setActorId(e.target.value); setPage(1); }} placeholder="24-hex user id" />
            </Field>
            <Field label="From"><Input className="w-36!" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
            <Field label="To"><Input className="w-36!" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
          </div>

          <Table
            loading={loading && !data}
            data={rows}
            onRowClick={(r) => setSelected(r)}
            empty={<EmptyState icon={History} title="No audit rows" message="Widen the filters or perform a catalog write." />}
            columns={[
              { key: 'when', header: 'When', render: (r) => <span className="text-xs text-slate-500">{fmtDateTime(r.createdAt)}</span> },
              { key: 'entity', header: 'Entity', render: (r) => (
                <div>
                  <p className="font-medium text-slate-800">{entityLabel(r.entityType)}</p>
                  <p className="font-mono text-[11px] text-slate-400">{r.entityId}</p>
                </div>
              ) },
              { key: 'action', header: 'Action', render: (r) => <Badge tone={pickMeta(AUDIT_ACTION_META, r.action).tone}>{pickMeta(AUDIT_ACTION_META, r.action).label}</Badge> },
              { key: 'actor', header: 'Actor', render: (r) => (
                <div>
                  <p className="font-mono text-xs text-slate-600">{r.actorId || 'system'}</p>
                  <p className="text-[11px] text-slate-400">{r.actorType || '—'}</p>
                </div>
              ) },
              { key: 'summary', header: 'Changed', render: (r) => {
                const keys = changedKeys(r.before, r.after);
                return <span className="text-xs text-slate-500">{keys.length ? keys.join(', ') : r.meta ? 'metadata' : '—'}</span>;
              } },
              { key: 'requestId', header: 'Request', render: (r) => <span className="font-mono text-[11px] text-slate-400">{r.requestId || '—'}</span> },
            ]}
            footer={<Pagination meta={meta} onPage={setPage} />}
          />
        </Card>
      )}

      {selected && <AuditDetail log={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AuditDetail({ log, onClose }) {
  const keys = changedKeys(log.before, log.after);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${pickMeta(AUDIT_ACTION_META, log.action).label} · ${entityLabel(log.entityType)}`}
      subtitle={`${log.entityId} · ${fmtDateTime(log.createdAt)}`}
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="Action" value={pickMeta(AUDIT_ACTION_META, log.action).label} />
          <Mini label="Actor type" value={log.actorType || 'system'} />
          <Mini label="Tenant" value={log.tenantId ? String(log.tenantId) : '—'} mono />
          <Mini label="IP" value={log.ipAddress || '—'} mono />
        </div>

        {keys.length > 0 && (
          <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Changed: <b>{keys.join(', ')}</b>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Before</p>
            <pre className="max-h-[340px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{fmtJson(log.before)}</pre>
          </section>
          <section className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">After</p>
            <pre className="max-h-[340px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{fmtJson(log.after)}</pre>
          </section>
        </div>

        {log.meta && (
          <section className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Metadata</p>
            <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{fmtJson(log.meta)}</pre>
          </section>
        )}
      </div>
    </Modal>
  );
}

function Mini({ label, value, mono = false }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <p className={`mt-1 truncate text-sm font-medium text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}
