import { Quote, Star } from 'lucide-react';
import SectionHeader from './SectionHeader.jsx';
import { cn } from '../lib/utils.js';

export function Stars({ value = 5, className }) {
  const v = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${v} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn('h-3.5 w-3.5', i < v ? 'fill-amber-400 text-amber-400' : 'text-slate-300')}
        />
      ))}
    </span>
  );
}

/** Customer love — snap-scrolling cards that work from 1 to 12 entries. */
export default function Testimonials({ items = [], title = 'Loved by customers' }) {
  if (!items.length) return null;
  return (
    <section aria-label={title}>
      <SectionHeader title={title} subtitle={`${items.length} verified review${items.length === 1 ? '' : 's'} from this store`} />
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {items.map((t, i) => (
          <figure
            key={`${t.name}-${i}`}
            className="card flex w-72 shrink-0 snap-start flex-col gap-2 p-5 sm:w-80"
          >
            <Quote className="h-5 w-5" style={{ color: 'var(--brand)' }} />
            <blockquote className="line-clamp-4 text-sm leading-relaxed text-slate-700">
              “{t.text}”
            </blockquote>
            <figcaption className="mt-auto flex items-center gap-2.5 pt-2">
              {t.avatarUrl ? (
                <img src={t.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" loading="lazy" />
              ) : (
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  {(t.name || '?').trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-slate-900">{t.name}</span>
                {t.rating != null && <Stars value={t.rating} />}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
