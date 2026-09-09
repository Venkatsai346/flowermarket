import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api.js';
import Button from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';

const STATE_COLORS = {
  connected: 'bg-green-100 text-green-700',
  connecting: 'bg-yellow-100 text-yellow-700',
  disconnected: 'bg-red-100 text-red-700',
  disconnecting: 'bg-orange-100 text-orange-700',
};

function StatCard({ label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color || 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function ConnectionPoolPage() {
  const { data: pool, isLoading, refetch } = useQuery({
    queryKey: ['pool-stats'],
    queryFn: () => api.get('/admin/phase74/pool/stats').then((r) => r.data?.data),
    refetchInterval: 30000,
  });

  const { data: events } = useQuery({
    queryKey: ['pool-events'],
    queryFn: () => api.get('/admin/phase74/pool/events').then((r) => r.data?.data),
  });

  const { data: dedup } = useQuery({
    queryKey: ['dedup-stats'],
    queryFn: () => api.get('/admin/phase74/dedup/stats').then((r) => r.data?.data),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Connection Pool & Dedup</h1>
          <p className="text-sm text-gray-500 mt-1">
            MongoDB connection health and request deduplication stats
          </p>
        </div>
        <Button onClick={() => refetch()} variant="secondary">↻ Refresh</Button>
      </div>

      {/* Connection status */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-800">MongoDB Connection</h2>
          <Badge className={STATE_COLORS[pool?.state] || STATE_COLORS.disconnected}>
            {pool?.state || 'unknown'}
          </Badge>
          {pool?.pingMs != null && (
            <span className="text-sm text-gray-500">Ping: {pool.pingMs}ms</span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <StatCard
            label="Current Connections"
            value={pool?.pool?.current ?? '—'}
            sub={`of max ${pool?.config?.maxPoolSize ?? '?'}`}
          />
          <StatCard
            label="Available"
            value={pool?.pool?.available ?? '—'}
            color={(pool?.pool?.available || 0) < 5 ? 'text-red-600' : 'text-green-600'}
          />
          <StatCard label="Active" value={pool?.pool?.active ?? '—'} />
          <StatCard
            label="Rejected"
            value={pool?.pool?.rejected ?? 0}
            color={(pool?.pool?.rejected || 0) > 0 ? 'text-red-600' : 'text-green-600'}
          />
        </div>

        {/* Pool config */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Max Pool Size" value={pool?.config?.maxPoolSize ?? '—'} />
          <StatCard label="Min Pool Size" value={pool?.config?.minPoolSize ?? '—'} />
          <StatCard label="Max Idle Time" value={pool?.config?.maxIdleTimeMs ? `${pool.config.maxIdleTimeMs / 1000}s` : '—'} />
          <StatCard label="Server Version" value={pool?.server?.version ?? '—'} />
        </div>
      </div>

      {/* Connection events */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Connection Events</h2>
        {events && events.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {events.map((ev, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="text-gray-400 text-xs font-mono">{ev.at}</span>
                <Badge className={
                  ev.type === 'connected' ? 'bg-green-100 text-green-700' :
                  ev.type === 'disconnected' ? 'bg-red-100 text-red-700' :
                  ev.type.startsWith('error') ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }>
                  {ev.type}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No connection events recorded</p>
        )}
      </div>

      {/* Dedup stats */}
      {dedup && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Request Deduplication</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Cache Size"
              value={dedup.cache?.size ?? 0}
              sub={`max ${dedup.cache?.max ?? 0}`}
            />
            <StatCard label="Cache Hits" value={dedup.cache?.hits ?? 0} />
            <StatCard label="Cache Misses" value={dedup.cache?.misses ?? 0} />
            <StatCard
              label="In-Flight"
              value={dedup.inflight ?? 0}
              color={dedup.inflight > 10 ? 'text-yellow-600' : 'text-gray-900'}
            />
          </div>
          <div className="mt-4 text-sm text-gray-500">
            Hit rate: {dedup.cache?.hits && dedup.cache?.misses
              ? `${Math.round((dedup.cache.hits / (dedup.cache.hits + dedup.cache.misses)) * 100)}%`
              : 'N/A'}
          </div>
        </div>
      )}
    </div>
  );
}
