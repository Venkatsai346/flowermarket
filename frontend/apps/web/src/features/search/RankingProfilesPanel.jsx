import { useState } from 'react';
import { Layers, Plus, RefreshCw } from 'lucide-react';
import { fmtDateTime } from '@flower-market/shared';
import { rid } from '../../lib/utils.js';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import ProfileEditor from './ProfileEditor.jsx';

export default function RankingProfilesPanel({ profiles, defaults, onChanged }) {
  const [editing, setEditing] = useState(null); // profile | {} for new
  const rows = profiles || [];

  const activeTraffic = rows.filter((p) => p.isActive).reduce((sum, p) => sum + (Number(p.trafficPct) || 0), 0);

  return (
    <Card
      title="Ranking profiles"
      subtitle="The relevance recipe for your store. Active profiles must add up to 100% traffic."
      actions={
        <>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={onChanged}>Refresh</Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setEditing({})}>New profile</Button>
        </>
      }
      bodyClassName="p-0!"
    >
      <div className="divide-y divide-slate-100">
        {rows.map((p) => {
          const isActive = Boolean(p.isActive);
          return (
            <div key={rid(p)} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm font-bold text-slate-900">{p.code}</p>
                  <span className="text-sm font-medium text-slate-700">{p.name}</span>
                  {p.isDefault && <Badge tone="violet">Default</Badge>}
                  {isActive ? <Badge tone="emerald" dot>Active</Badge> : <Badge tone="slate">Inactive</Badge>}
                  {p.trafficPct > 0 && <Badge tone="amber">{p.trafficPct}% traffic</Badge>}
                </div>
                {p.description && <p className="mt-1 max-w-lg truncate text-xs text-slate-500">{p.description}</p>}
                <p className="mt-1.5 text-[11px] text-slate-400">
                  {p.updatedAt ? `Updated ${fmtDateTime(p.updatedAt)}` : `Created ${fmtDateTime(p.createdAt)}`}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex max-w-[300px] flex-wrap gap-1">
                  {Object.entries(p.weights || {})
                    .slice(0, 4)
                    .map(([k, v]) => (
                      <Badge key={k} tone="slate" className="font-mono">{(k).toUpperCase()} {Number(v).toFixed(1)}</Badge>
                    ))}
                  {Object.keys(p.weights || {}).length > 4 && <Badge tone="slate" className="font-mono">+{Object.keys(p.weights || {}).length - 4}</Badge>}
                </div>
                <Button variant="secondary" size="sm" onClick={() => setEditing(p)}>Edit</Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
        {rows.length} profile(s) · active traffic {activeTraffic}% of sessions
      </div>

      {editing && (
        <ProfileEditor
          profile={editing.id || editing._id ? editing : null}
          defaults={defaults}
          profiles={rows}
          onClose={() => {
            setEditing(null);
            onChanged?.();
          }}
        />
      )}
    </Card>
  );
}
