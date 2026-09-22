import { lazy, Suspense, useState } from 'react';
import { BookOpen, Boxes, History, Inbox, UploadCloud, Zap } from 'lucide-react';
import { useAuthStore } from '@flower-market/shared';
import { cn } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import ListingPanel from './ListingPanel.jsx';
import ReviewQueuePanel from './ReviewQueuePanel.jsx';
import AuditPanel from './AuditPanel.jsx';
import EventPanel from './EventPanel.jsx';
import BulkPanel from './BulkPanel.jsx';

const CatalogGuidanceBook = lazy(() => import('./CatalogGuidanceBook.jsx'));

// Listings + bulk are tenant-scoped (store owners included); review/audit/
// events are platform operations hitting super_admin-only APIs.
const TABS = [
  ['listings', 'Listings', Boxes, ['admin', 'super_admin']],
  ['guide', 'Guidance book', BookOpen, ['admin', 'super_admin']],
  ['review', 'Review queue', Inbox, ['super_admin']],
  ['audit', 'Audit', History, ['super_admin']],
  ['events', 'Events', Zap, ['super_admin']],
  ['bulk', 'Bulk', UploadCloud, ['admin', 'super_admin']],
];

export default function CatalogOpsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const visibleTabs = TABS.filter(([, , , roles]) => roles.includes(role));
  const [tab, setTab] = useState('listings');
  const activeTab = visibleTabs.some(([key]) => key === tab) ? tab : 'listings';

  return (
    <div>
      <PageHeader
        title="Catalog deep admin"
        description="Store listings, shared-catalog approvals, the immutable audit trail and the event pipeline."
      />

      <nav className="mb-5 flex flex-wrap gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
        {visibleTabs.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition',
              activeTab === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      {activeTab === 'listings' && <ListingPanel />}
      {activeTab === 'guide' && <Suspense fallback={<div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">Opening the guidance book…</div>}><CatalogGuidanceBook /></Suspense>}
      {activeTab === 'review' && <ReviewQueuePanel />}
      {activeTab === 'audit' && <AuditPanel />}
      {activeTab === 'events' && <EventPanel />}
      {activeTab === 'bulk' && <BulkPanel />}
    </div>
  );
}
