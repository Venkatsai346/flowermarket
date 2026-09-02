import { cn } from '../../lib/utils.js';

export function Field({ label, error, hint, required, children, className }) {
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <label className="label mb-0!">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}

export function Input({ className, ...rest }) {
  return <input className={cn('input', className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cn('input', className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }) {
  return <textarea className={cn('input min-h-[84px]', className)} {...rest} />;
}

export function Checkbox({ label, className, ...rest }) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 text-sm text-slate-700', className)}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-rose-600 accent-rose-600"
        {...rest}
      />
      {label}
    </label>
  );
}
