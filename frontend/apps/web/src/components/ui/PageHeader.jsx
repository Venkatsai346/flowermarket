import { ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export default function PageHeader({ title, description, actions, back, className }) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-start justify-between gap-3', className)}>
      <div>
        {back && (
          <button className="btn-ghost btn-sm mb-2 px-2!" onClick={back}>
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
        )}
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
