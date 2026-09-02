import { cn } from '../../lib/utils.js';

const TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
};

export default function Badge({ tone = 'slate', dot = false, children, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[tone] || TONES.slate,
        className
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', `bg-current`)} />}
      {children}
    </span>
  );
}
