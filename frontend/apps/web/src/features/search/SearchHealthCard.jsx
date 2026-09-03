import { Activity, Database, RefreshCw, Timer } from 'lucide-react';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Stat from '../../components/ui/Stat.jsx';

export default function SearchHealthCard({ health, onReindex, onRefresh }) {
  const provider = health?.provider || {};
  const freshness = health?.freshness || {};
  const providerOk = provider.ok !== false;
  const missing = Number(freshness.missing) || 0;
  const staleSample = Number(freshness.staleSample) || 0;
  const dirty = !providerOk || missing > 0 || staleSample > 0;

  return (
    <Card
      title="Search health"
      subtitle="Provider reachability + index freshness."
      actions={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={onRefresh}>Refresh</Button>}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Provider" value={provider.provider || '—'} sub={providerOk ? 'reachable' : 'unreachable'} icon={Database} tone={providerOk ? 'emerald' : 'rose'} />
          <Stat label="Documents" value={Number(provider.documents ?? freshness.indexedDocuments ?? 0)} sub="in the search index" icon={Activity} tone="sky" />
          <Stat label="Missing" value={missing} sub={`${freshness.listings ?? 0} listings`} icon={Activity} tone={missing ? 'amber' : 'emerald'} />
          <Stat label="Stale sample" value={staleSample} sub="older than the freshness window" icon={Timer} tone={staleSample ? 'amber' : 'emerald'} />
        </div>

        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-medium uppercase tracking-wide text-slate-500">Freshness</span>
            {dirty ? <Badge tone="amber" dot>Action needed</Badge> : <Badge tone="emerald" dot>Healthy</Badge>}
          </div>
          <p>
            {missing > 0
              ? `${missing} listing(s) not yet in the index. A reindex scans the catalogue and refreshes every document.`
              : 'Every active listing has a search document. Run reindex after catalogue changes to pick them up immediately.'}
            {staleSample > 0 && ` ${staleSample} stale document(s) in the latest sample.`}
          </p>
        </div>

        <Button variant="primary" className="w-full" icon={RefreshCw} onClick={onReindex}>Run reindex</Button>
      </div>
    </Card>
  );
}
