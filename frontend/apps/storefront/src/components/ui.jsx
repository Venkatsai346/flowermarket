import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils.js';

export function Button({ variant = 'brand', size, loading, icon: Icon, children, className, ...rest }) {
  return (
    <button
      type="button"
      className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function Money({ value, className, strike = false }) {
  const n = Number(value) || 0;
  const text = `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
  return <span className={cn('tabular-nums', strike && 'text-slate-400 line-through', className)}>{text}</span>;
}

export function Skeleton({ className }) {
  return <div className={cn('skeleton', className)} />;
}

export function ProductSkeleton() {
  return (
    <div className="card overflow-hidden">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-8 w-full rounded-full" />
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icon && (
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'var(--brand-soft)' }}>
          <Icon className="h-6 w-6" style={{ color: 'var(--brand)' }} />
        </span>
      )}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Bottom sheet on mobile, side drawer on desktop — one component, both idioms. */
export function Sheet({ open, onClose, title, subtitle, children, footer, side = 'right' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="animate-fade absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn(
          'animate-sheet relative z-10 flex w-full flex-col bg-white shadow-lift',
          side === 'right'
            ? 'ml-auto h-full max-w-md sm:rounded-l-3xl'
            : 'mt-auto max-h-[88vh] rounded-t-3xl sm:m-auto sm:max-w-lg sm:rounded-3xl'
        )}
      >
        <header className="shrink-0 border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="shrink-0 border-t border-slate-100 px-5 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, busy }) {
  return (
    <div className="inline-flex items-center rounded-full" style={{ background: 'var(--brand-soft)' }}>
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={busy || value <= min}
        onClick={() => onChange(value - 1)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-medium disabled:opacity-40"
        style={{ color: 'var(--brand)' }}
      >
        −
      </button>
      <span className="w-7 text-center text-sm font-bold tabular-nums" style={{ color: 'var(--brand)' }}>
        {busy ? '·' : value}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={busy || value >= max}
        onClick={() => onChange(value + 1)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-medium disabled:opacity-40"
        style={{ color: 'var(--brand)' }}
      >
        +
      </button>
    </div>
  );
}

export function Toasts({ items }) {
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            'animate-sheet pointer-events-auto rounded-full px-4 py-2.5 text-sm font-medium shadow-lift',
            t.tone === 'error' ? 'bg-rose-600 text-white' : t.tone === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
