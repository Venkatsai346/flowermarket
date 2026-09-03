import { useState } from 'react';
import { Languages, RefreshCw, Search, SlidersHorizontal, Waves } from 'lucide-react';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { LoadingBlock } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import Stat from '../../components/ui/Stat.jsx';
import RankingProfilesPanel from './RankingProfilesPanel.jsx';
import SearchHealthCard from './SearchHealthCard.jsx';
import SearchAnalyticsPanel from './SearchAnalyticsPanel.jsx';
import SynonymsPanel from './SynonymsPanel.jsx';
import ReindexModal from './ReindexModal.jsx';

export default function SearchAdminPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [reindex, setReindex] = useState(false);
  const { data, loading, error } = useApi(
    () => Promise.all([
      api.search.profiles(),
      api.search.synonyms(),
      api.search.health(),
    ]).then(([profiles, synonyms, health]) => ({
      profiles: profiles.data?.items || [],
      defaults: profiles.data?.defaults || {},
      synonyms: synonyms.data?.items || [],
      health: health.data || {},
    })),
    [refreshKey],
  );

  const profiles = data?.profiles || [];
  const synonyms = data?.synonyms || [];
  const health = data?.health || {};
  const activeProfiles = profiles.filter((p) => p.isActive);
  const trafficTotal = activeProfiles.reduce((s, p) => s + (Number(p.trafficPct) || 0), 0);
  const missingIndex = Number(health.freshness?.missing) || 0;
  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div>
      <PageHeader
        title="Search admin"
        description="Teach the ranked storefront what your customers actually type."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh</Button>
            <Button variant="primary" icon={Waves} onClick={() => setReindex(true)}>Reindex</Button>
          </>
        }
      />

      {error && !data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div>
            <p className="text-sm font-semibold text-rose-700">Couldn’t load search admin</p>
            <p className="mt-0.5 text-xs text-rose-600">{errMsg(error)}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>
        </div>
      ) : loading && !data ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Ranking profiles" value={profiles.length} sub={`${activeProfiles.length} active`} icon={SlidersHorizontal} tone="sky" />
            <Stat label="Traffic routed" value={`${trafficTotal}%`} sub="active profiles ≤ 100%" icon={SlidersHorizontal} tone="violet" />
            <Stat label="Synonym rules" value={synonyms.length} sub="store + platform vocabulary" icon={Languages} tone="emerald" />
            <Stat label="Index" value={missingIndex ? 'Stale' : 'Healthy'} sub={missingIndex ? `${missingIndex} listing(s) missing` : 'all listings indexed'} icon={Search} tone={missingIndex ? 'amber' : 'emerald'} />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <RankingProfilesPanel profiles={profiles} defaults={data?.defaults || {}} onChanged={refresh} />
            </div>
            <SearchHealthCard health={health} onReindex={() => setReindex(true)} onRefresh={refresh} />
          </div>

          <div className="mt-5">
            <SearchAnalyticsPanel />
          </div>

          <div className="mt-5">
            <SynonymsPanel synonyms={synonyms} onChanged={refresh} />
          </div>
        </>
      )}

      {reindex && (
        <ReindexModal
          onClose={() => {
            setReindex(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
