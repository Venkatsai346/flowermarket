import { useState } from 'react';
import { FileText, Landmark, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { cn, errMsg } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import RegistrationPanel from './RegistrationPanel.jsx';
import DocumentList from './DocumentList.jsx';
import SeriesAuditPanel from './SeriesAuditPanel.jsx';
import RatePoliciesPanel from './RatePoliciesPanel.jsx';

const TAB_ICONS = {
  registration: Landmark,
  documents: FileText,
  series: ShieldCheck,
  rates: Landmark,
};

export default function TaxPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [tab, setTab] = useState('registration');
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useApi(() => api.tax.registration(), [refreshKey]);
  const isSuperAdmin = role === 'super_admin';
  const tabs = [...(isSuperAdmin ? [['registration', 'Registration'], ['documents', 'Documents'], ['series', 'Series audit'], ['rates', 'Rates & policies']] : [['registration', 'Registration'], ['documents', 'Documents'], ['series', 'Series audit']])];

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div>
      <PageHeader
        title="GST & tax admin"
        description="Registration, documents and the platform rate table."
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh</Button>}
      />

      {error && !data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div>
            <p className="text-sm font-semibold text-rose-700">Couldn’t load registration</p>
            <p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>
        </div>
      ) : loading && !data ? (
        <LoadingBlock />
      ) : (
        <>
          <nav className="mb-5 flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1.5">
            {tabs.map(([key, label]) => {
              const Icon = TAB_ICONS[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
                    tab === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </nav>

          {tab === 'registration' && (
            <RegistrationPanel data={data} loading={loading} refreshKey={refreshKey} onChanged={refresh} />
          )}
          {tab === 'documents' && <DocumentList refreshKey={refreshKey} />}
          {tab === 'series' && <SeriesAuditPanel />}
          {tab === 'rates' && isSuperAdmin && <RatePoliciesPanel />}
        </>
      )}
    </div>
  );
}
