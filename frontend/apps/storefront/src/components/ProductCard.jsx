
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Check, Heart, Package, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { inr } from '@flower-market/shared';
import { Money, Stepper } from './ui.jsx';
import ProductImage from './ProductImage.jsx';
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
export default function ProductCard({
  listing,
  qtyByListing,
  busyId,
  onAdd,
  onQty,
}) {
  const grouped =
    Array.isArray(listing?.variants) && listing.variants.length > 0;

  if (grouped) {
    return (
      <GroupedCard
        listing={listing}
        qtyByListing={qtyByListing}
        busyId={busyId}
        onAdd={onAdd}
        onQty={onQty}
      />
    );
  }

  const p = listing.product || {};

  const line = {
    listingId: listing.listingId,
    variantId: listing.variantId || listing.variant?.id || null,
    variantLabel: listing.variant?.displayLabel || listing.variant?.value || null,
    sellerSku: listing.sellerSku || null,
    price: listing.price,
    priceBasis: listing.priceBasis,
    stockQty: listing.stockQty ?? 0,
    product: p,
  };
  const productPath = `/p/${p.slug || p.id || listing.listingId}`;

  return (
    <CardShell
      title={p.title}
      href={line.variantId ? { pathname: productPath, search: `?variantId=${line.variantId}` } : productPath}
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

function GroupedCard({
  listing,
  qtyByListing,
  busyId,
  onAdd,
  onQty,
}) {
  const p = listing.product || {};
  const variants = listing.variants;

  const [selId, setSelId] = useState(
    listing.defaultListingId || variants[0]?.listingId,
  );

  useEffect(() => {
    setSelId(
      listing.defaultListingId || variants[0]?.listingId,
    );
  }, [listing.masterId]);

  const sel =
    variants.find(
      (v) => String(v.listingId) === String(selId),
    ) || variants[0];

  const line = {
    listingId: sel.listingId,
    variantId: sel.variantId || null,
    variantLabel: sel.label || sel.value || null,
    sellerSku: sel.sellerSku || null,
    price: {
      sellingPrice: sel.price?.sellingPrice ?? 0,
      mrp: sel.price?.mrp ?? null,
    },
    priceBasis: sel.priceBasis || listing.priceBasis,
    stockQty: sel.stockQty ?? 0,
    product: {
      ...p,
      imageUrl: sel.imageUrl || p.imageUrl,
    },
  };

  const multi = variants.length > 1;
  const typeLabel = sel.variantType
    ? sel.variantType.replace(/_/g, ' ')
    : 'Option';

  return (
    <CardShell
      title={p.title}
      href={{
        pathname: `/p/${p.slug || p.id || listing.masterId}`,
        search: sel.variantId
          ? `?variantId=${sel.variantId}`
          : '',
      }}
      imageUrl={sel.imageUrl || p.imageUrl}
      unit={p.defaultSellingUnit}
      line={line}
      qty={
        qtyByListing?.get(String(line.listingId))?.qty ||
        0
      }
      busy={
        busyId != null &&
        String(busyId) === String(line.listingId)
      }
      onAdd={onAdd}
      onQty={onQty}
      selector={
        multi ? (
          <label className="mt-1.5 block">
            <span className="mb-1 block text-[11px] font-medium capitalize text-slate-400">
              {typeLabel}:{' '}
              <span className="font-semibold text-slate-600">
                {sel.label || sel.value}
              </span>
            </span>

            <span className="relative block">
              <select
                value={String(sel.listingId)}
                onChange={(e) =>
                  setSelId(e.target.value)
                }
                aria-label={`Choose ${typeLabel} for ${p.title}`}
                className="input w-full appearance-none !py-1.5 pr-8 text-[13px] font-medium"
              >
                {variants.map((v) => (
                  <option
                    key={v.listingId}
                    value={String(v.listingId)}
                  >
                    {v.label || v.value || 'Standard'} ·{' '}
                    {inr(v.price?.sellingPrice ?? 0)}
                    {(v.stockQty ?? 0) <= 0
                      ? ' · sold out'
                      : ''}
                  </option>
                ))}
              </select>

              <svg
                viewBox="0 0 16 16"
                aria-hidden
                className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              >
                <path
                  d="M4 6l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </label>
        ) : null
      }
    />
  );
}

function CardShell({
  title,
  href,
  imageUrl,
  unit,
  line,
  qty,
  busy,
  onAdd,
  onQty,
  selector,
}) {
  const price = line.price?.sellingPrice ?? 0;
  const mrp = line.price?.mrp ?? null;

  const off =
    mrp && mrp > price
      ? Math.round(((mrp - price) / mrp) * 100)
      : 0;

  const stock = line.stockQty ?? 0;
  const out = stock <= 0;
  const low = !out && stock <= 5;

  // Wishlist identity comes from the active product.
  const product = line.product || {};
  const basisQuantity = line.priceBasis?.quantity || 1;
  const basisUnit = line.priceBasis?.unitCode || unit;
  // Never infer a public claim from the master's aggregate status: individual
  // evidence may have expired since indexing. Only disclose records the public
  // projection has already verified and date-filtered.
  const verified = (product.compliance || []).length > 0;
  const packCount = (product.packages || []).length;

  const slug =
    product.slug ||
    product.id ||
    line.listingId;

  const wishlistTitle =
    product.title || title;

  const wishlistImage =
    product.imageUrl || imageUrl || '';

  const wishlistItem = {
    slug,
    listingId: line.listingId,
    variantId: line.variantId,
    variantLabel: line.variantLabel,
    sellerSku: line.sellerSku,
  };
  const { isWishlisted, toggle } = useWishlist();
  const wishlisted = isWishlisted(wishlistItem);

  return (
    <article
      className={cn(
        'card group relative flex flex-col overflow-hidden rounded-3xl border-slate-200/80 transition duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-lift',
        out && 'bg-slate-50/50',
      )}
    >
      <Link
        to={href}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 text-left sm:aspect-square"
        aria-label={`View ${title}`}
      >
        <ProductImage
          src={imageUrl}
          alt={title}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
        />

        <span className="absolute left-2 top-2 flex flex-col items-start gap-1.5">
          {off > 0 && (
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
              {off}% off
            </span>
          )}
          {product.kind === 'bundle' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-700/90 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur"><Sparkles className="h-3 w-3" />Bundle</span>
          )}
        </span>

        {out && (
          <span className="absolute inset-x-0 bottom-0 bg-slate-900/75 py-1.5 text-center text-xs font-semibold text-white">
            Out of stock
          </span>
        )}
      </Link>

      <button
          type="button"
          onClick={() => {
            toggle({
              ...wishlistItem,
              title: wishlistTitle,
              imageUrl: wishlistImage,
              price,
            });
          }}
          className={cn(
            'absolute right-2.5 top-2.5 z-10 grid h-9 w-9 place-items-center rounded-full border shadow-sm backdrop-blur transition duration-200 hover:scale-105 active:scale-95',
            wishlisted
              ? 'border-rose-200 bg-rose-50 text-rose-600'
              : 'border-white/70 bg-white/90 text-slate-500 hover:text-rose-600',
          )}
          aria-label={
            wishlisted
              ? 'Remove from wishlist'
              : 'Add to wishlist'
          }
          aria-pressed={wishlisted}
        >
          <Heart
            className={cn(
              'h-[18px] w-[18px] transition-transform',
              wishlisted && 'scale-110 fill-current',
            )}
          />
        </button>

      <div className="flex flex-1 flex-col gap-1 px-3.5 pb-3.5 pt-3">
        {(product.brand?.name || product.brandName) && (
          <p className="flex items-center gap-1 truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
            {product.brand?.name || product.brandName}{product.brand?.isVerified && <BadgeCheck className="h-3 w-3 text-sky-500" />}
          </p>
        )}
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800 transition group-hover:text-slate-950">
          <Link to={href} className="focus-visible:rounded-sm">{title}</Link>
        </h3>
        {line.variantLabel && (
          <p className="line-clamp-1 text-[11px] font-semibold text-slate-500" title={line.variantLabel}>{line.variantLabel}</p>
        )}

        {basisUnit && (
          <p className="text-[11px] font-medium text-slate-400">
            {basisQuantity === 1 ? 'per' : 'price for'} {basisQuantity} {basisUnit}
          </p>
        )}
        {(verified || packCount > 0) && (
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {verified && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700"><ShieldCheck className="h-3 w-3" />Verified</span>}
            {packCount > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500"><Package className="h-3 w-3" />{packCount} pack option{packCount === 1 ? '' : 's'}</span>}
          </div>
        )}

        {selector}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <Money
              value={price}
              className="text-base font-bold text-slate-900"
            />

            {off > 0 && (
              <Money
                value={mrp}
                strike
                className="ml-1.5 text-xs"
              />
            )}

            {low && (
              <p className="text-[11px] font-medium text-amber-600">
                Only {stock} left
              </p>
            )}
          </div>

          {out ? (
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400">
              Sold out
            </span>
          ) : qty > 0 ? (
            <Stepper
              value={qty}
              onChange={(n) => onQty?.(line, n)}
              busy={busy}
              max={Math.min(stock, 20)}
            />
          ) : (
            <button
              type="button"
              onClick={() => onAdd?.(line)}
              disabled={busy}
              className="btn btn-soft btn-sm"
              aria-label={`Add ${title} to cart`}
            >
              {busy ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

