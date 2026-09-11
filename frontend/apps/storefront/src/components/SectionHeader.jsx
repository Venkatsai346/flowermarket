import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

/** Homepage section heading with an optional "View all" link. */
export default function SectionHeader({ title, subtitle, actionTo, actionLabel }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl tracking-tight text-slate-900 sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actionTo && (
        <Link
          to={actionTo}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold hover:underline"
          style={{ color: 'var(--brand)' }}
        >
          {actionLabel || 'View all'}
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
