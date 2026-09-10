import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus } from 'lucide-react';
import { inr } from '@flower-market/shared';
import { Money, Stepper } from './ui.jsx';
import FloralImage from './FloralImage.jsx';
import { cn } from '../lib/utils.js';
import { useWishlist } from '../lib/useWishlist.js';

/**
 * A product tile — two shapes, one look.
 *
 * Flat rows (`{ listingId, price, product }`) render exactly as before.
 * Grouped cards (`{ masterId, product, variants[] }`, from `?groupBy=master`)
 * render a variant dropdown: the photo, price, stock and add-to-cart control
 * all follow the selected variant, so one tile sells the whole family.
 *
 * Callbacks always receive the ACTIVE line: `onAdd(line)`, `onQty(line, qty)`.
 */
export default function ProductCard({ listing, qtyByListing, busyId, onAdd, onQty }) {
  const grouped = Array.isArray(listing?.variants) && listing.variants.length > 0;
  if (grouped) return <GroupedCard listing={listing} qtyByListing={qtyByListing} busyId={busyId} onAdd={onAdd} onQty={onQty} />;

  const p = listing.product || {};
  const line = {
    listingId: listing.listingId,
    price: listing.price,
    stockQty: listing.stockQty ?? 0,
    product: p,
  };
  return (
    <CardShell
      title={p.title}
      href={`/p/${p.slug || p.id || listing.listingId}`}
      imageUrl={p.imageUrl}
      unit={p.defaultSellingUnit}
      line={line}
      qty={qtyByListing?.get(String(line.listingId))?.qty || 0}
      busy={busyId != null && String(busyId) === String(line.listingId)}
      onAdd={onAdd}
      onQty={onQty}
    />
  );
}

function GroupedCard({ listing, qtyByListing, busyId, onAdd, onQty }) {
  const p = listing.product || {};
  const variants = listing.variants;
  const [selId, setSelId] = useState(listing.defaultListingId || variants[0]?.listingId);

  useEffect(() => {
    setSelId(listing.defaultListingId || variants[0]?.listingId);
  }, [listing.masterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = variants.find((v) => String(v.listingId) === String(selId)) || variants[0];
  const line = {
    listingId: sel.listingId,
    price: { sellingPrice: sel.price?.sellingPrice ?? 0, mrp: sel.price?.mrp ?? null },
    stockQty: sel.stockQty ?? 0,
    product: { ...p, imageUrl: sel.imageUrl || p.imageUrl },
  };
  const multi = variants.length > 1;
  const typeLabel = sel.variantType ? sel.variantType.replace(/_/g, ' ') : 'Option';

  return (
    <CardShell
      title={p.title}
      href={{ pathname: `/p/${p.slug || p.id || listing.masterId}`, search: sel.variantId ? `?variantId=${sel.variantId}` : '' }}
      imageUrl={sel.imageUrl || p.imageUrl}
      unit={p.defaultSellingUnit}
      line={line}
      qty={qtyByListing?.get(String(line.listingId))?.qty || 0}
      busy={busyId != null && String(busyId) === String(line.listingId)}
      onAdd={onAdd}
      onQty={onQty}
      selector={multi ? (
        <label className="mt-1.5 block">
          <span className="mb-1 block text-[11px] font-medium capitalize text-slate-400">
            {typeLabel}: <span className="font-semibold text-slate-600">{sel.label || sel.value}</span>
          </span>
          <span className="relative block">
            <select
              value={String(sel.listingId)}
              onChange={(e) => setSelId(e.target.value)}
              aria-label={`Choose ${typeLabel} for ${p.title}`}
              className="input w-full appearance-none !py-1.5 pr-8 text-[13px] font-medium"
            >
              {variants.map((v) => (
                <option key={v.listingId} value={String(v.listingId)}>
                  {v.label || v.value || 'Standard'} · {inr(v.price?.sellingPrice ?? 0)}{(v.stockQty ?? 0) <= 0 ? ' · sold out' : ''}
                </option>
              ))}
            </select>
            <svg viewBox="0 0 16 16" aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400">
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </label>
      ) : null}
    />
  );
}

function CardShell({ title, href, imageUrl, unit, line, qty, busy, onAdd, onQty, selector }) {
  const price = line.price?.sellingPrice ?? 0;
  const mrp = line.price?.mrp ?? null;
  const off = mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
  const stock = line.stockQty ?? 0;
  const out = stock <= 0;
  const low = !out && stock <= 5;

  return (
    <article className={cn('card group relative flex flex-col overflow-hidden transition hover:shadow-lift', out && 'opacity-70')}>
      <Link
        to={href}
        className="relative block aspect-square w-full overflow-hidden bg-slate-50 text-left"
        aria-label={`View ${title}`}
      >
        {imageUrl ? (
          <FloralImage
            src={imageUrl}
            alt={title}
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
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">{title}</h3>
        {unit && <p className="text-[11px] text-slate-400">per {unit}</p>}
        {selector}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <Money value={price} className="text-base font-bold text-slate-900" />
            {off > 0 && <Money value={mrp} strike className="ml-1.5 text-xs" />}
            {low && <p className="text-[11px] font-medium text-amber-600">Only {stock} left</p>}
          </div>

          {out ? (
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400">Sold out</span>
          ) : qty > 0 ? (
            <Stepper value={qty} onChange={(n) => onQty?.(line, n)} busy={busy} max={Math.min(stock, 20)} />
          ) : (
            <button
              type="button"
              onClick={() => onAdd?.(line)}
              disabled={busy}
              className="btn btn-soft btn-sm"
              aria-label={`Add ${title} to cart`}
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
