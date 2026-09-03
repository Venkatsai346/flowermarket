import { useMemo, useState } from 'react';
import { Languages, Plus, Search } from 'lucide-react';
import { pickMeta } from '@flower-market/shared';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input } from '../../components/ui/Field.jsx';
import Table from '../../components/ui/Table.jsx';
import SynonymModal from './SynonymModal.jsx';
import { SYNONYM_TYPE_META } from './searchMeta.js';

export default function SynonymsPanel({ synonyms, onChanged }) {
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(false);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (synonyms || []).filter((s) => {
      if (!q) return true;
      return (s.terms || []).some((t) => String(t).toLowerCase().includes(q))
        || String(s.note || '').toLowerCase().includes(q)
        || String(s.from || '').toLowerCase().includes(q);
    });
  }, [synonyms, query]);

  return (
    <Card
      title="Synonyms"
      subtitle="Vocabulary you teach search when customers type a name it does not know."
      actions={
        <>
          <Button variant="secondary" icon={Plus} onClick={() => setModal(true)}>Add synonym</Button>
        </>
      }
      bodyClassName="p-0!"
    >
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9!" placeholder="Filter by term or note…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="text-xs text-slate-400">{rows.length} rule(s)</span>
      </div>

      <Table
        data={rows}
        rowKey="id"
        empty={<EmptyState icon={Languages} title="No synonyms" message="Add a synonym to fix a term customers keep typing." />}
        columns={[
          { key: 'terms', header: 'Terms', render: (r) => (
            <div className="flex flex-wrap gap-1">
              {(r.terms || []).map((t) => <Badge key={t} tone="slate">{t}</Badge>)}
            </div>
          ) },
          { key: 'type', header: 'Type', render: (r) => (
            <span className="flex items-center gap-1 text-xs text-slate-600">
              <Badge tone={pickMeta(SYNONYM_TYPE_META, r.type).tone}>{pickMeta(SYNONYM_TYPE_META, r.type).label}</Badge>
              {r.type === 'oneway' && <span className="font-mono">from {r.from}</span>}
            </span>
          ) },
          { key: 'tenantId', header: 'Scope', render: (r) => (
            r.tenantId === null ? <Badge tone="violet">Platform-wide</Badge> : <Badge tone="sky">This store</Badge>
          ) },
          { key: 'note', header: 'Note', render: (r) => <span className="block max-w-[260px] truncate">{r.note || '—'}</span> },
          { key: 'isActive', header: 'Status', render: (r) => (
            r.isActive ? <Badge tone="emerald" dot>Active</Badge> : <Badge tone="slate">Inactive</Badge>
          ) },
        ]}
      />

      {modal && (
        <SynonymModal
          onClose={() => {
            setModal(false);
            onChanged?.();
          }}
        />
      )}
    </Card>
  );
}
