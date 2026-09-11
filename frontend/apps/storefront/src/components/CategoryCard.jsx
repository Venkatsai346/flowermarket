import { Link } from 'react-router-dom';
import { ArrowRight, Star } from 'lucide-react';
import FloralImage from './FloralImage.jsx';
import { Money } from './ui.jsx';

/**
 * Rich category card — hero image, live (subtree) product count, from-price,
 * and child-category shortcuts. Links are siblings, never nested: the image,
 * the name and every child chip navigate independently.
 */
export default function CategoryCard({ node, showChildren = true }) {
  if (!node) return null;
  const to = `/browse?category=${node.id}`;
  const total = Number(node.totalCount ?? node.productCount) || 0;
  const kids = (node.children || []).slice(0, 4);
  const extra = Math.max(0, (node.children || []).length - kids.length);

  return (
    <div className="card group flex flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-lift">
      <Link to={to} className="relative block aspect-[16/10] overflow-hidden bg-slate-100" aria-label={`Browse ${node.name}`}>
        <FloralImage
          src={node.bannerUrl || node.imageUrl}
          alt=""
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
        />
        <span className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
        {node.isFeatured && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Featured
          </span>
        )}
        <span className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-2">
          <span className="font-display text-lg leading-tight text-white drop-shadow">{node.name}</span>
          <span className="shrink-0 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold tabular-nums text-slate-800 backdrop-blur">
            {total}
          </span>
        </span>
      </Link>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
        {node.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">{node.description}</p>
        )}
        {showChildren && kids.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {kids.map((k) => (
              <Link
                key={k.id}
                to={`/browse?category=${k.id}`}
                className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-transparent"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--brand-soft)';
                  e.currentTarget.style.color = 'var(--brand)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '';
                  e.currentTarget.style.color = '';
                }}
              >
                {k.name}
              </Link>
            ))}
            {extra > 0 && (
              <Link to={to} className="px-1 py-1 text-[11px] font-bold" style={{ color: 'var(--brand)' }}>
                +{extra} more
              </Link>
            )}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
          <span className="font-semibold text-slate-600">
            {total} product{total === 1 ? '' : 's'}
            {node.fromPrice != null && (
              <span className="text-slate-400">
                {' '}· from <Money value={node.fromPrice} className="font-bold text-slate-700" />
              </span>
            )}
          </span>
          <Link
            to={to}
            className="inline-flex items-center gap-1 font-bold transition hover:gap-2"
            style={{ color: 'var(--brand)' }}
            aria-label={`Browse ${node.name}`}
          >
            Browse <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
