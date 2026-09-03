import { Radio } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import Badge from '../../components/ui/Badge.jsx';
import { RIDER_AVAILABILITY_META, RIDER_AVAILABILITY_OPTIONS } from './riderMeta.js';

export default function AvailabilitySwitch({ value, busy, onChange }) {
  const meta = RIDER_AVAILABILITY_META[value] || { label: 'Offline', tone: 'slate' };
  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500">
          <Radio className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">Rider availability</p>
          <div className="mt-0.5">
            <Badge tone={meta.tone} dot>{meta.label}</Badge>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {RIDER_AVAILABILITY_OPTIONS.map(([v, label]) => (
          <button
            key={v}
            disabled={busy}
            onClick={() => onChange?.(v)}
            className={cn(
              'btn',
              value === v ? 'btn-primary' : 'btn-secondary',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
