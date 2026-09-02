import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export default function Pagination({ meta, onPage, className }) {
  if (!meta || meta.total <= meta.limit) return null;
  const { page = 1, totalPages = 1 } = meta;
  return (
    <div className={cn('flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3', className)}>
      <p className="text-xs text-slate-500">
        Page {page} of {totalPages} · {meta.total} total
      </p>
      <div className="flex items-center gap-1">
        <button
          className="btn-ghost btn-sm px-2!"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          className="btn-ghost btn-sm px-2!"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
