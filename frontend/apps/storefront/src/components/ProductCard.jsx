import { Link } from 'react-router-dom';
import { Check, Heart, Plus } from 'lucide-react';
import { Money, Stepper } from './ui.jsx';
import FloralImage from './FloralImage.jsx';
import { cn } from '../lib/utils.js';
import { useWishlist } from '../lib/useWishlist.js';

/**
 * A product tile.
 *
 * The add-to-cart control turns into a stepper in place once the item is in
 * the cart — the customer never has to open the cart to change a quantity,
 * which is the single biggest driver of basket size in grocery-style shops.
 */
export default function ProductCard({ listing, qty = 0, busy, onAdd, onQty, onOpen }) {
  const { isWishlisted, toggle } = useWishlist();
  const p = listing.product || {};
  const price = listing.price?.sellingPrice ?? 0;
  const mrp = listing.price?.mrp ?? null;
  const off = mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
  const stock = listing.stockQty ?? 0;
  const out = stock <= 0;
  const low = !out && stock <= 5;
  const slug = p.slug || p.id || listing.listingId;
  const href = `/p/${slug}`;
  const wishlisted = isWishlisted(slug);

  return (
    <article className={cn('card group relative flex flex-col overflow-hidden transition hover:shadow-lift', out && 'opacity-70')}>
      <Link
        to={href}
        className="relative block aspect-square w-full overflow-hidden bg-slate-50 text-left"
        aria-label={`View ${p.title}`}
      >
        {p.imageUrl ? (
          <FloralImage
            src={p.imageUrl}
            alt={p.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center text-4xl"
            style={{ background: 'var(--brand-soft)' }}
            aria-hidden
          >
            🌸
          </span>
        )}
        {off > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
            {off}% off
          </span>
        )}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle({ slug, title: p.title, imageUrl: p.imageUrl, price }); }}
          className={cn(
            'absolute right-2 top-2 rounded-full p-1.5 shadow-sm transition',
            wishlisted
              ? 'bg-rose-100 text-rose-600'
              : 'bg-white/80 text-slate-400 opacity-0 group-hover:opacity-100',
          )}
          aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
        >
          <Heart className={cn('h-4 w-4', wishlisted && 'fill-current')} />
        </button>
        {out && (
          <span className="absolute inset-x-0 bottom-0 bg-slate-900/75 py-1.5 text-center text-xs font-semibold text-white">
            Out of stock
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">{p.title}</h3>
        {p.defaultSellingUnit && <p className="text-[11px] text-slate-400">per {p.defaultSellingUnit}</p>}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <Money value={price} className="text-base font-bold text-slate-900" />
            {off > 0 && <Money value={mrp} strike className="ml-1.5 text-xs" />}
            {low && <p className="text-[11px] font-medium text-amber-600">Only {stock} left</p>}
          </div>

          {out ? (
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400">Sold out</span>
          ) : qty > 0 ? (
            <Stepper value={qty} onChange={onQty} busy={busy} max={Math.min(stock, 20)} />
          ) : (
            <button
              type="button"
              onClick={() => onAdd?.(listing)}
              disabled={busy}
              className="btn btn-soft btn-sm"
              aria-label={`Add ${p.title} to cart`}
            >
              {busy ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              Add
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
