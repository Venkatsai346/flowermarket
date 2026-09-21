import { AlertCircle, Check, ChevronRight, CircleHelp, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export function WizardNav({ steps, active, onChange, completed = [] }) {
  return (
    <nav aria-label="Form progress" className="sticky -top-5 z-20 -mx-6 mb-6 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
      <ol className="flex min-w-max items-center gap-1 overflow-x-auto pb-1 sm:justify-center">
        {steps.map((step, index) => {
          const done = completed.includes(step.id);
          const selected = active === step.id;
          return (
            <li key={step.id} className="flex items-center">
              {index > 0 && <ChevronRight className="mx-0.5 h-3.5 w-3.5 text-slate-300" />}
              <button
                type="button"
                onClick={() => onChange(step.id)}
                aria-current={selected ? 'step' : undefined}
                className={cn(
                  'group flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition duration-200',
                  selected ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
                )}
              >
                <span className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold transition',
                  selected ? 'border-white/30 bg-white/15' : done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white',
                )}>
                  {done ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <span><span className="block text-xs font-semibold">{step.label}</span><span className={cn('hidden text-[10px] sm:block', selected ? 'text-white/60' : 'text-slate-400')}>{step.caption}</span></span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SectionIntro({ eyebrow, title, description, badge, icon: Icon = Sparkles }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-900 text-white shadow-sm"><Icon className="h-4.5 w-4.5" /></span>
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-500">{eyebrow}</p>}
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-bold text-slate-900">{title}</h3>{badge && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{badge}</span>}</div>
        {description && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{description}</p>}
      </div>
    </div>
  );
}

export function Guidance({ title, children, tone = 'blue' }) {
  const tones = {
    blue: 'border-sky-200 bg-sky-50 text-sky-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return (
    <aside className={cn('flex gap-2.5 rounded-2xl border p-3 text-xs leading-relaxed', tones[tone] || tones.blue)}>
      <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
      <div>{title && <p className="font-bold">{title}</p>}<div className="mt-0.5 opacity-80">{children}</div></div>
    </aside>
  );
}

export function SubmissionError({ message, code }) {
  if (!message) return null;
  return (
    <div role="alert" aria-live="assertive" className="animate-in flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-rose-800 shadow-sm">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-rose-100"><AlertCircle className="h-4 w-4" /></span>
      <div><p className="text-sm font-bold">We couldn’t save this yet</p><p className="mt-0.5 text-xs leading-relaxed">{message}</p>{code && <p className="mt-1 font-mono text-[10px] text-rose-500">Reference: {code}</p>}</div>
    </div>
  );
}

export function ReviewItem({ label, value, ready = true }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={cn('max-w-[65%] truncate text-right text-xs font-semibold', ready ? 'text-slate-800' : 'text-amber-600')}>{value || 'Needs attention'}</span>
    </div>
  );
}
