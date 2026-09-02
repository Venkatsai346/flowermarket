import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export function Spinner({ className }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-rose-500', className)} />;
}

/** Full-area centered loading block */
export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="grid min-h-[240px] place-items-center">
      <div className="flex flex-col items-center gap-2 text-sm text-slate-500">
        <Spinner />
        {label}
      </div>
    </div>
  );
}
