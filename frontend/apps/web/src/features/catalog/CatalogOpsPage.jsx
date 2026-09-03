import { useState } from 'react';
import { Boxes, History, Inbox, UploadCloud, Zap } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import ListingPanel from './ListingPanel.jsx';
import ReviewQueuePanel from './ReviewQueuePanel.jsx';
import AuditPanel from './AuditPanel.jsx';
import EventPanel from './EventPanel.jsx';
import BulkPanel from './BulkPanel.jsx';

const TABS = [
  ['listings', 'Listings', Boxes],
  ['review', 'Review queue', Inbox],
  ['audit', 'Audit', History],
  ['events', 'Events', Zap],
  ['bulk', 'Bulk', UploadCloud],
];

export default function CatalogOpsPage() {
  const [tab, setTab] = useState('listings');

  return (
    <div>
      <PageHeader
        title="Catalog deep admin"
        description="Store listings, shared-catalog approvals, the immutable audit trail and the event pipeline."
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

      {tab === 'listings' && <ListingPanel />}
      {tab === 'review' && <ReviewQueuePanel />}
      {tab === 'audit' && <AuditPanel />}
      {tab === 'events' && <EventPanel />}
      {tab === 'bulk' && <BulkPanel />}
    </div>
  );
}
