import { cn } from '../../lib/utils.js';

/** KPI card — label, big value, optional sub-line and icon. */
export default function Stat({ label, value, sub, icon: Icon, tone = 'rose', className }) {
  const iconTones = {
    rose: 'bg-rose-50 text-rose-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    sky: 'bg-sky-50 text-sky-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className={cn('kpi', className)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {Icon && (
          <span className={cn('grid h-8 w-8 place-items-center rounded-lg', iconTones[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
