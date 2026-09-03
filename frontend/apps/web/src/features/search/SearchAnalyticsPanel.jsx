import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarRange, RefreshCw, SearchX } from 'lucide-react';
import { dayRange } from '@flower-market/shared';
import { api } from '../../api.js';
import { useApi } from '../../lib/useApi.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Field, Input } from '../../components/ui/Field.jsx';
import Table from '../../components/ui/Table.jsx';
import Stat from '../../components/ui/Stat.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { ctrTooltip } from './searchMeta.js';

const tooltipFormatter = (value) => [`${Number(value).toFixed(1)}%`, ''];

export default function SearchAnalyticsPanel() {
  const [range, setRange] = useState(() => dayRange(30));
  const { data, loading, refetch } = useApi(
    () => api.search.analytics({ from: range.from, to: range.to }),
    [range.from, range.to],
  );

  const analytics = data || {};
  const topQueries = analytics.topQueries || [];
  const zeroResultQueries = analytics.zeroResultQueries || [];
  const experiments = analytics.experiments || [];
  const latency = analytics.latency || {};
  const maxSearches = Math.max(1, ...topQueries.map((t) => Number(t.searches) || 0));

  const chartData = experiments.map((e) => ({
    bucket: e.bucket === 'variant' ? 'Variant' : 'Control',
    Searches: Number(e.searches) || 0,
    CTR: Number((Number(e.clickThroughRate) || 0) * 100),
    Cart: Number((Number(e.addToCartRate) || 0) * 100),
    Zero: Number((Number(e.zeroResultRate) || 0) * 100),
  }));

  return (
    <Card
      title="Search analytics"
      subtitle="What people look for, what they never find, and how the experiment arms compare."
      actions={
        <Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="From">
          <Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </Field>
        <Field label="To">
          <Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Queries" value={topQueries.reduce((s, t) => s + (Number(t.searches) || 0), 0)} icon={CalendarRange} tone="sky" />
          <Stat label="Avg latency" value={latency.avgMs ? `${latency.avgMs}ms` : '—'} sub={`max ${latency.maxMs || 0}ms`} icon={CalendarRange} tone="violet" />
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="mb-3 text-sm font-semibold text-slate-800">Top queries</p>
          <div className="space-y-2.5">
            {topQueries.map((t) => (
              <div key={t.query}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-slate-700">{t.query}</span>
                  <span className="shrink-0 text-slate-500">{t.searches} searches · {ctrTooltip(t.ctr)}% CTR</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.round((t.searches / maxSearches) * 100)}%` }} />
                </div>
              </div>
            ))}
            {!topQueries.length && <p className="text-sm text-slate-400">No query activity in this window.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="mb-3 text-sm font-semibold text-slate-800">Experiment arms</p>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={tooltipFormatter} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="CTR" fill="#e11d48" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Cart" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Zero" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon={CalendarRange} title="No experiment data" message="Profiles with traffic between 0% and 100% create variant/control buckets automatically." />
          )}
        </div>
      </div>

      <div className="mt-5">
        <Table
          loading={loading && !data}
          data={zeroResultQueries}
          rowKey="query"
          empty={<EmptyState icon={SearchX} title="No zero-result queries" message="Nothing returned zero results in this window." />}
          columns={[
            { key: 'query', header: 'Query' },
            { key: 'searches', header: 'Searches', align: 'right' },
            { key: 'hint', header: 'Fix', render: () => <Badge tone="amber">Add a synonym</Badge> },
          ]}
        />
      </div>
    </Card>
  );
}
