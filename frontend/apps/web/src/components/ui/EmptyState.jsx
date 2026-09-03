import { Inbox } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export default function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', message, action, compact = false }) {
  return (
    <div className={cn('grid place-items-center px-6 text-center', compact ? 'min-h-[120px] py-6' : 'min-h-[220px] py-10')}>
      <div>
        <div className={cn('mx-auto mb-3 grid place-items-center rounded-2xl bg-slate-100 text-slate-400', compact ? 'h-9 w-9' : 'h-12 w-12')}>
          <Icon className={compact ? 'h-4 w-4' : 'h-6 w-6'} />
        </div>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        {message && <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">{message}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
