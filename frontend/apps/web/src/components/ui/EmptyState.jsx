import { Inbox } from 'lucide-react';

export default function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', message, action }) {
  return (
    <div className="grid min-h-[220px] place-items-center px-6 py-10 text-center">
      <div>
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
          <Icon className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        {message && <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">{message}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
