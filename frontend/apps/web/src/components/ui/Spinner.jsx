import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const SIZES = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-8 w-8' };

export function Spinner({ className, size = 'md' }) {
  return <Loader2 className={cn(SIZES[size] || SIZES.md, 'animate-spin text-rose-500', className)} />;
}

/** Full-area centered loading block. Use `compact` inside cards/drawers. */
export function LoadingBlock({ label = 'Loading…', compact = false }) {
  return (
    <div className={cn('grid place-items-center', compact ? 'min-h-[120px] py-6' : 'min-h-[240px]')}>
      <div className="flex flex-col items-center gap-2 text-sm text-slate-500">
        <Spinner size={compact ? 'sm' : 'md'} />
        {label}
      </div>
    </div>
  );
}
