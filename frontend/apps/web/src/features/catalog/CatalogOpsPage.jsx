import { useState } from 'react';
import { History, Inbox, Zap } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import ReviewQueuePanel from './ReviewQueuePanel.jsx';
import AuditPanel from './AuditPanel.jsx';
import EventPanel from './EventPanel.jsx';

// Platform catalog operations — super_admin only (route-guarded in App.jsx).
// Store listings / bulk upload live in "My catalog" (the store owner's page);
// shared-catalog approvals, the audit trail and the event pipeline are
// platform concerns and belong here.
const TABS = [
  ['review', 'Review queue', Inbox],
  ['audit', 'Audit', History],
  ['events', 'Events', Zap],
];

export default function CatalogOpsPage() {
  const [tab, setTab] = useState('review');

  return (
    <div>
      <PageHeader
        title="Catalog deep admin"
        description="Shared-catalog approvals, the immutable audit trail and the event pipeline."
      />

      <nav className="mb-5 flex flex-wrap gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition',
              tab === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      {tab === 'review' && <ReviewQueuePanel />}
      {tab === 'audit' && <AuditPanel />}
      {tab === 'events' && <EventPanel />}
    </div>
  );
}
