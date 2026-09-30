import { ImageOff, Package } from 'lucide-react';
import { cn } from '../lib/utils.js';

/** Neutral media placeholder suitable for every catalog vertical. */
export default function ProductFallback({ className, compact = false, label = 'Image coming soon' }) {
  return (
    <span
      className={cn('relative isolate flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 text-slate-400', className)}
      role="img"
      aria-label={label}
    >
      <span className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/60" />
      <span className="absolute -bottom-10 -left-8 h-28 w-28 rounded-full bg-white/40" />
      <span className="relative flex flex-col items-center gap-2">
        <span className={cn('relative grid place-items-center rounded-2xl border border-white/80 bg-white/80 shadow-sm backdrop-blur', compact ? 'h-9 w-9' : 'h-14 w-14')}>
          <Package className={compact ? 'h-4 w-4' : 'h-6 w-6'} aria-hidden />
          <ImageOff className={cn('absolute translate-x-3 translate-y-3 rounded-full bg-white p-0.5 text-slate-500', compact ? 'h-3.5 w-3.5' : 'h-5 w-5')} aria-hidden />
        </span>
        {!compact && <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Image coming soon</span>}
      </span>
    </span>
  );
}
