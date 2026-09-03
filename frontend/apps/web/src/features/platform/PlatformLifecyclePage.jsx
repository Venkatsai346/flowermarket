import { useState } from 'react';
import { Activity, HeartPulse, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import KycPanel from './KycPanel.jsx';
import LifecyclePanel from './LifecyclePanel.jsx';
import AutomationPanel from './AutomationPanel.jsx';

const TABS = [
  ['lifecycle', 'Lifecycle', HeartPulse],
  ['kyc', 'KYC review', ShieldCheck],
  ['automation', 'Ops automation', Activity],
];

export default function PlatformLifecyclePage() {
  const [tab, setTab] = useState('lifecycle');

  return (
    <div>
      <PageHeader
        title="Platform lifecycle & ops"
        description="Store and vendor health, the payout KYC gate, and idempotent automation passes."
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

      {tab === 'lifecycle' && <LifecyclePanel />}
      {tab === 'kyc' && <KycPanel />}
      {tab === 'automation' && <AutomationPanel />}
    </div>
  );
}
