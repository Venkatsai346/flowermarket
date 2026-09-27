import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BadgeCheck, CheckCircle2, ChevronLeft, Droplets, FileText, Heart, Leaf, LockKeyhole, PackageCheck, Play, RotateCcw, Scissors, Share2, ShieldCheck, Snowflake, Sun, Truck } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { useCartActions } from '../lib/useCart.js';
import { t } from '../i18n.js';
import { recordViewed } from '../lib/viewed.js';
import { useWishlist } from '../lib/useWishlist.js';
import { resolveVariantForOption, selectedOptionValues, variantOptionState } from '../lib/productVariants.js';
import ProductCard from '../components/ProductCard.jsx';
import FloralImage from '../components/FloralImage.jsx';
import ArrivalPromise from '../components/ArrivalPromise.jsx';
import { Button, Empty, Money, ProductSkeleton, Stepper } from '../components/ui.jsx';
import { cn, errMsg } from '../lib/utils.js';

const CARE_DEFAULT = 'Trim stems on an angle, change the water daily, keep out of direct sun and away from fruit. A cool room stretches vase life.';
const OCCASIONS = ['birthday', 'anniversary', 'sorry', 'pooja', 'wedding', 'love', 'congratulations'];
const ADDON_RE = /vase|greeting.?card|\bcard\b|chocolate|addon|teddy/i;

function attrMap(list) {
  const m = {};
  for (const a of list || []) m[a.key || a.attributeKey] = { value: a.value, unit: a.unit };
  return m;
}

function JsonLd({ product, listing, store }) {
  const price = listing?.price?.sellingPrice;
  const images = (product?.images || []).map((i) => i.url).filter(Boolean);
  if (product?.imageUrl && !images.includes(product.imageUrl)) images.unshift(product.imageUrl);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product?.title,
    description: product?.shortDescription || product?.description || undefined,
    sku: product?.skuGlobal,
    image: images.length ? images : undefined,
    brand: product?.brand?.name ? { '@type': 'Brand', name: product.brand.name } : undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: listing?.price?.currency || 'INR',
      price,
      availability: (listing?.stockQty ?? 0) > 0
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: store?.name ? { '@type': 'Organization', name: store.name } : undefined,
    },
  };
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}

export default function Product() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const store = useShop((s) => s.store);
  const language = useShop((s) => s.language);
  const nextSlot = useShop((s) => s.nextSlot);
  const { qtyByListing, busyId, add, changeQty } = useCartActions();
  const { isWishlisted, toggle: toggleWishlist } = useWishlist();
  const [active, setActive] = useState(0);
  const [shareDone, setShareDone] = useState(false);
  const [selListingId, setSelListingId] = useState(null);
  const requestedVariantId = params.get('variantId') || '';

  const { data, loading, error } = useApi(
    () => api.shop.productBySlug(slug, {
      variantId: requestedVariantId || undefined,
    }),
    [slug, requestedVariantId]
  );

  const product = data?.product || {};
  const listing = data?.listing || {};
  const related = data?.related || [];
  const family = data?.variants || [];
  const multi = family.length > 1;

  // Seed the selection once the family arrives: ?variantId= wins when it names
  // a live member, otherwise the server's default. Switching afterwards is
  // instant — every family row already carries price, stock and gallery.
  useEffect(() => {
    if (!data) return;
    const want = params.get('variantId');
    const fromUrl = want ? family.find((v) => String(v.variantId) === want) : null;
    setSelListingId(fromUrl?.listingId || listing.listingId || listing.id || null);
    setActive(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => { setSelListingId(null); }, [slug]);

  const selected = family.find((v) => String(v.listingId) === String(selListingId)) || null;
  const optionDefinitions = (product.options || []).filter((definition) =>
    family.some((v) => (v.optionValues || []).some((o) => o.code === definition.code))
  );
  const selectedOptions = selectedOptionValues(selected);
  const effListing = selected
    ? { listingId: selected.listingId, price: selected.price, priceBasis: selected.priceBasis, stockQty: selected.stockQty, variantId: selected.variantId }
    : listing;

  const pick = (v) => {
    setSelListingId(v.listingId);
    setActive(0);
    const next = new URLSearchParams(params);
    if (v.variantId) next.set('variantId', v.variantId);
    else next.delete('variantId');
    setParams(next, { replace: true });
  };

  const pickOption = (code, value) => {
    const nextVariant = resolveVariantForOption(family, selected, code, value);
    if (nextVariant) pick(nextVariant);
  };

  const listingView = useMemo(() => ({
    listingId: effListing.listingId || effListing.id,
    price: effListing.price,
    stockQty: effListing.stockQty,
    product: {
      ...product,
      imageUrl: selected?.imageUrl || product.imageUrl || product.images?.[0]?.url,
    },
  }), [effListing, selected, product]);

  const gallery = selected?.images?.length ? selected.images : (product.images || []);
  const images = gallery.length
    ? gallery
    : product.imageUrl
      ? [{ url: product.imageUrl, altText: product.title, isPrimary: true }]
      : [];
  const attrs = { ...attrMap(product.attributes), ...attrMap(selected?.attributes) };
  const specificationRows = Object.entries(attrs).filter(([key]) => !['care_notes'].includes(key));
  const vase = attrs.vase_life_days;
  const colour = attrs.color || attrs.colour;
  const stems = attrs.stem_count || attrs.stems;
  const care = attrs.care_notes?.value || (product.isPerishable ? CARE_DEFAULT : null);
  const price = effListing.price?.sellingPrice ?? 0;
  const mrp = effListing.price?.mrp ?? null;
  const stock = effListing.stockQty ?? 0;
  const out = stock <= 0;
  const discount = mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
  const savings = discount ? mrp - price : 0;
  const wishlistSlug = product.slug || slug;
  const wishlisted = isWishlisted(wishlistSlug);
  const qty = qtyByListing.get(String(listingView.listingId))?.qty || 0;
  const tags = (product.tags || []).map((x) => String(x).toLowerCase());
  const occasions = tags.filter((x) => OCCASIONS.includes(x));
  const addons = related.filter((l) => ADDON_RE.test([
    l.product?.title, ...(l.product?.tags || []),
  ].filter(Boolean).join(' ')));

  const shareProduct = async () => {
    const shareData = { title: product.title, text: product.shortDescription || product.title, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else await navigator.clipboard.writeText(window.location.href);
      setShareDone(true);
      window.setTimeout(() => setShareDone(false), 1800);
    } catch (error) {
      if (error?.name !== 'AbortError') setShareDone(false);
    }
  };

  useEffect(() => { setActive(0); }, [slug]);

  useEffect(() => {
    if (!product?.title) return undefined;
    const previousTitle = document.title;
    const title = product.seo?.title || product.title;
    const description = product.seo?.description || product.shortDescription || product.description || '';
    document.title = `${title}${store?.name ? ` · ${store.name}` : ''}`;
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
    const previousDescription = meta.content;
    meta.content = description.slice(0, 180);
    return () => { document.title = previousTitle; if (created) meta.remove(); else meta.content = previousDescription; };
  }, [product?.title, product?.seo?.title, product?.seo?.description, product?.shortDescription, product?.description, store?.name]);

  useEffect(() => {
    if (!product?.title) return;
    recordViewed({
      slug: product.slug || slug,
      title: product.title,
      imageUrl: product.imageUrl || product.images?.[0]?.url,
    });
  }, [product?.title, product?.slug, product?.imageUrl, slug]);

  if (loading && !data) {
    return (
      <div className="wrap grid gap-8 py-8 lg:grid-cols-2">
        <ProductSkeleton />
        <div className="space-y-3">
          <div className="skeleton h-8 w-2/3" />
          <div className="skeleton h-5 w-1/3" />
          <div className="skeleton h-24 w-full" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="wrap py-16">
        <Empty
          floral
          title="We couldn't find that bouquet"
          message={errMsg(error) || 'The link may be old, or this store no longer lists it.'}
          action={<Button variant="soft" onClick={() => window.location.assign('/')}>{t(language, 'backToShop')}</Button>}
        />
      </div>
    );
  }

  return (
    <>
      <JsonLd product={product} listing={effListing} store={store} />
      <div className="wrap py-4 sm:py-6">
        <nav className="mb-5 flex items-center gap-1.5 overflow-hidden text-sm text-slate-500" aria-label="Breadcrumb">
          <Link to="/" className="inline-flex shrink-0 items-center gap-1 transition hover:text-slate-900">
            <ChevronLeft className="h-4 w-4" /> {t(language, 'backToShop')}
          </Link>
          {product.category?.name && <><span className="text-slate-300">/</span><Link to={`/browse?category=${product.category.id}`} className="truncate transition hover:text-slate-900">{product.category.name}</Link></>}
          <span className="hidden text-slate-300 sm:inline">/</span>
          <span className="hidden truncate text-slate-400 sm:inline">{product.title}</span>
        </nav>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)] xl:gap-12">
          <div className="lg:sticky lg:top-32">
            <div className="aspect-square overflow-hidden rounded-[2rem] border border-slate-200/70 bg-gradient-to-br from-slate-50 to-slate-100 shadow-soft" style={{ touchAction: 'pan-x pinch-zoom' }}>
              {images[active]?.url && images[active]?.mediaType === 'video' ? (
                <video src={images[active].url} controls playsInline className="h-full w-full bg-slate-950 object-contain" aria-label={images[active].altText || product.title} />
              ) : images[active]?.url && ['document', 'model_3d'].includes(images[active]?.mediaType) ? (
                <a href={images[active].url} target="_blank" rel="noreferrer" className="flex h-full flex-col items-center justify-center gap-3 text-slate-600">
                  <FileText className="h-14 w-14" /><span className="text-sm font-semibold">Open {images[active].mediaType === 'model_3d' ? '3D model' : 'document'}</span>
                </a>
              ) : images[active]?.url ? (
                <FloralImage
                  src={images[active].url}
                  alt={images[active].altText || product.title}
                  priority
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-7xl" style={{ background: 'var(--brand-soft)' }} aria-hidden>🌸</span>
              )}
            </div>
            {images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {images.map((img, i) => (
                  <button
                    key={img.url + i}
                    type="button"
                    onClick={() => setActive(i)}
                    aria-label={`Image ${i + 1}`}
                    className="h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-offset-2"
                    style={i === active ? { boxShadow: '0 0 0 2px var(--brand)' } : undefined}
                  >
                    {img.mediaType === 'video' ? (
                      <span className="grid h-full w-full place-items-center bg-slate-900 text-white"><Play className="h-5 w-5" /></span>
                    ) : ['document', 'model_3d'].includes(img.mediaType) ? (
                      <span className="grid h-full w-full place-items-center bg-slate-100 text-slate-500"><FileText className="h-5 w-5" /></span>
                    ) : <FloralImage src={img.url} alt="" className="h-full w-full object-cover" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
              {product.category?.name && <Link to={`/browse?category=${product.category.id}`} className="transition hover:text-slate-700">{product.category.name}</Link>}
              {product.category?.name && product.brand?.name && <span>·</span>}
              {product.brand?.name && <Link to={`/brands/${product.brand.id}`} className="inline-flex items-center gap-1 transition hover:text-slate-700">{product.brand.name}<BadgeCheck className="h-3.5 w-3.5 text-sky-500" /></Link>}
            </div>
            <div className="mt-2 flex items-start justify-between gap-4">
              <h1 className="font-display min-w-0 text-3xl leading-[1.08] tracking-tight text-slate-950 sm:text-[2.6rem]">{product.title}</h1>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => toggleWishlist({ slug: wishlistSlug, title: product.title, imageUrl: selected?.imageUrl || product.imageUrl || images[0]?.url, price })}
                  className={cn('grid h-11 w-11 place-items-center rounded-full border shadow-sm transition hover:-translate-y-0.5', wishlisted ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-slate-200 bg-white text-slate-500 hover:text-rose-600')}
                  aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                  aria-pressed={wishlisted}
                >
                  <Heart className={cn('h-5 w-5', wishlisted && 'fill-current')} />
                </button>
                <button type="button" onClick={shareProduct} className="grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:text-slate-900" aria-label="Share product">
                  {shareDone ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Share2 className="h-5 w-5" />}
                </button>
              </div>
            </div>
            {product.shortDescription && (
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{product.shortDescription}</p>
            )}

            {occasions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {occasions.map((o) => (
                  <Link key={o} to={`/search?q=${encodeURIComponent(o)}`} className="chip capitalize !py-1 !text-xs">
                    {o}
                  </Link>
                ))}
              </div>
            )}

            {multi && optionDefinitions.length > 0 && (
              <div className="mt-6 space-y-5 rounded-3xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm sm:p-5">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Choose your configuration</p>
                    <p className="mt-0.5 text-xs text-slate-500">Selecting an option moves to the closest available combination.</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-slate-500 shadow-sm ring-1 ring-slate-200">{family.length} variants</span>
                </div>
                {optionDefinitions.map((definition) => (
                  <div key={definition.code}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {definition.name}<span className="ml-1.5 normal-case text-slate-800">— {selectedOptions[definition.code]}</span>
                    </p>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Choose ${definition.name}`}>
                      {definition.values.map((value) => {
                        const state = variantOptionState(family, definition.code, value);
                        const activeOption = selectedOptions[definition.code] === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={activeOption}
                            aria-label={`${definition.name} ${value}${state.inStock ? '' : state.exists ? ', sold out' : ', unavailable'}`}
                            disabled={!state.exists}
                            onClick={() => pickOption(definition.code, value)}
                            className={cn(
                              'relative min-h-11 rounded-xl border px-3.5 py-2 text-sm font-semibold transition duration-200',
                              activeOption ? 'border-slate-950 bg-slate-950 text-white shadow-md' : 'border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-sm',
                              !state.inStock && state.exists && !activeOption && 'border-dashed text-slate-400',
                              !state.exists && 'cursor-not-allowed opacity-35 line-through',
                            )}
                          >
                            {value}
                            {!state.inStock && state.exists && <span className="ml-1 text-[9px] font-bold uppercase tracking-wide">Sold out</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="border-t border-slate-200 pt-4">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Available combinations</p>
                  <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Choose complete product configuration">
                    {family.map((variant) => {
                      const isSelected = String(variant.listingId) === String(selListingId);
                      const soldOut = Number(variant.stockQty || 0) <= 0;
                      return (
                        <button
                          key={variant.listingId}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => pick(variant)}
                          className={cn('min-w-40 shrink-0 rounded-xl border px-3 py-2.5 text-left transition', isSelected ? 'border-slate-950 bg-white shadow-md ring-1 ring-slate-950' : 'border-slate-200 bg-white/70 hover:border-slate-400', soldOut && !isSelected && 'opacity-60')}
                        >
                          <span className="line-clamp-2 block text-xs font-bold text-slate-800">{variant.label || variant.value || 'Standard'}</span>
                          <span className={cn('mt-1 block text-[11px] font-semibold', soldOut ? 'text-rose-500' : 'text-emerald-700')}>{soldOut ? 'Sold out' : <><Money value={variant.price?.sellingPrice ?? 0} /> · {variant.stockQty} left</>}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {multi && optionDefinitions.length === 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {(selected?.variantType || 'Option').replace(/_/g, ' ')}
                  {selected?.label && <span className="ml-1.5 normal-case text-slate-700">— {selected.label}</span>}
                </p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Choose a variant">
                  {family.map((v) => {
                    const isSel = String(v.listingId) === String(selListingId);
                    const vOut = (v.stockQty ?? 0) <= 0;
                    return (
                      <button
                        key={v.listingId}
                        type="button"
                        role="radio"
                        aria-checked={isSel}
                        onClick={() => pick(v)}
                        className={cn(
                          'flex min-w-[7rem] flex-col items-start gap-0.5 rounded-2xl border px-3.5 py-2.5 text-left transition',
                          isSel
                            ? 'border-transparent bg-slate-900 text-white shadow-lift'
                            : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400',
                          vOut && !isSel && 'opacity-60'
                        )}
                      >
                        <span className="text-[13px] font-semibold leading-tight">{v.label || v.value || 'Standard'}</span>
                        <span className={cn('text-xs', isSel ? 'text-white/80' : 'text-slate-500')}>
                          <Money value={v.price?.sellingPrice ?? 0} />
                          {vOut && <span className="ml-1.5 font-medium">· sold out</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-6 rounded-3xl border border-slate-200/80 bg-white p-4 shadow-soft">
              <div className="flex flex-wrap items-end gap-x-2.5 gap-y-1">
                <Money value={price} className="text-3xl font-extrabold tracking-tight text-slate-950" />
                {mrp && mrp > price && <Money value={mrp} strike className="pb-1 text-sm" />}
                {discount > 0 && <span className="mb-0.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{discount}% off</span>}
              </div>
              {savings > 0 && <p className="mt-1 text-xs font-semibold text-emerald-700">You save <Money value={savings} /> on this option</p>}
              {(effListing.priceBasis?.unitCode || product.defaultSellingUnit) && (
                <p className="mt-1 text-xs text-slate-400">Inclusive of applicable taxes · price per {effListing.priceBasis?.quantity || 1} {effListing.priceBasis?.unitCode || product.defaultSellingUnit}</p>
              )}
              {selected?.label && <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500"><span className="font-semibold text-slate-700">Selected:</span> {selected.label}</p>}
            </div>

            <div className="mt-4">
              <ArrivalPromise />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {vase && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  <Droplets className="h-3.5 w-3.5" />Vase life {vase.value}{vase.unit ? ` ${vase.unit}` : ' days'}
                </span>
              )}
              {stems && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {stems.value} stems
                </span>
              )}
              {colour && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium capitalize text-slate-600">
                  {colour.value}
                </span>
              )}
              {product.isPerishable && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  <Leaf className="h-3.5 w-3.5" />Fresh · perishable
                </span>
              )}
              {product.requiresColdChain && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                  <Snowflake className="h-3.5 w-3.5" />Cold chain
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                <Truck className="h-3.5 w-3.5" />Slot delivery
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                UPI
              </span>
              {nextSlot?.codAllowed && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  COD
                </span>
              )}
            </div>

            <div className="sticky bottom-3 z-20 mt-6 rounded-3xl border border-slate-200/80 bg-white/95 p-3 shadow-lift backdrop-blur lg:static lg:bg-white lg:p-4 lg:shadow-soft">
              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <span className={cn('inline-flex items-center gap-1.5 text-sm font-bold', out ? 'text-rose-600' : 'text-emerald-700')}>
                  <span className={cn('h-2 w-2 rounded-full', out ? 'bg-rose-500' : 'bg-emerald-500')} />
                  {out ? 'Currently unavailable' : 'In stock and ready to order'}
                </span>
                {!out && <span className="text-xs font-medium text-slate-400">{stock} available</span>}
              </div>
              {out ? (
                <Button className="w-full" variant="outline" disabled>Out of stock</Button>
              ) : qty > 0 ? (
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">{t(language, 'inYourBasket')}</span>
                  <Stepper value={qty} onChange={(q) => changeQty(listingView, q)} busy={busyId === listingView.listingId} max={Math.min(stock, 20)} />
                </div>
              ) : (
                <Button className="w-full" loading={busyId === listingView.listingId} onClick={() => add(listingView)}>
                  Add to basket · <Money value={price} />
                </Button>
              )}
              {!out && stock <= 5 && (
                <p className="mt-2 text-sm font-medium text-amber-600">Only {stock} left in stock</p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 text-center">
              <span className="flex min-h-20 flex-col items-center justify-center gap-1 border-r border-slate-200 px-2 py-3 text-[11px] font-semibold text-slate-600"><LockKeyhole className="h-4 w-4" style={{ color: 'var(--brand)' }} />Secure checkout</span>
              <span className="flex min-h-20 flex-col items-center justify-center gap-1 border-r border-slate-200 px-2 py-3 text-[11px] font-semibold text-slate-600"><RotateCcw className="h-4 w-4" style={{ color: 'var(--brand)' }} />Order support</span>
              <span className="flex min-h-20 flex-col items-center justify-center gap-1 px-2 py-3 text-[11px] font-semibold text-slate-600"><ShieldCheck className="h-4 w-4" style={{ color: 'var(--brand)' }} />Protected order</span>
            </div>

            {care && (
              <section className="mt-8 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Scissors className="h-4 w-4" style={{ color: 'var(--brand)' }} /> Care
                </h2>
                <p className="text-sm leading-relaxed text-slate-600">{care}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400">
                  <Sun className="h-3.5 w-3.5" /> Keep cool, never on a sunny sill.
                </p>
              </section>
            )}

            {product.description && (
              <p className="mt-6 text-sm leading-relaxed text-slate-600">{product.description}</p>
            )}

            {specificationRows.length > 0 && (
              <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <h2 className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800"><PackageCheck className="h-4 w-4" style={{ color: 'var(--brand)' }} />Specifications{selected?.label && <span className="font-normal text-slate-400">· {selected.label}</span>}</h2>
                <dl className="grid sm:grid-cols-2">
                  {specificationRows.map(([key, item]) => (
                    <div key={key} className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 text-sm odd:sm:border-r">
                      <dt className="capitalize text-slate-500">{key.replace(/_/g, ' ')}</dt>
                      <dd className="text-right font-semibold text-slate-800">{typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}{item.unit ? ` ${item.unit}` : ''}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {(product.manufacturer || product.modelNumber || product.countryOfOrigin || product.identifiers?.gtin || product.fulfillmentProfile?.weight?.value || product.unitPolicy || product.warranty?.duration != null) && (
              <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200">
                <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">Product information</h2>
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3 p-4 text-sm">
                  {product.manufacturer && <><dt className="text-slate-500">Manufacturer</dt><dd className="font-medium text-slate-800">{product.manufacturer}</dd></>}
                  {product.modelNumber && <><dt className="text-slate-500">Model</dt><dd className="font-medium text-slate-800">{product.modelNumber}</dd></>}
                  {product.condition && <><dt className="text-slate-500">Condition</dt><dd className="font-medium capitalize text-slate-800">{product.condition}</dd></>}
                  {product.countryOfOrigin && <><dt className="text-slate-500">Country of origin</dt><dd className="font-medium text-slate-800">{product.countryOfOrigin}</dd></>}
                  {product.identifiers?.gtin && <><dt className="text-slate-500">GTIN</dt><dd className="font-mono text-xs text-slate-800">{product.identifiers.gtin}</dd></>}
                  {product.fulfillmentProfile?.weight?.value != null && <><dt className="text-slate-500">Shipping weight</dt><dd className="font-medium text-slate-800">{product.fulfillmentProfile.weight.value} {product.fulfillmentProfile.weight.unit}</dd></>}
                  {product.unitPolicy && <><dt className="text-slate-500">Available units</dt><dd className="font-medium text-slate-800">{(product.unitPolicy.units || []).map((unit) => unit.label).join(', ')}</dd></>}
                  {product.warranty?.duration != null && <><dt className="text-slate-500">Warranty</dt><dd className="font-medium text-slate-800">{`${product.warranty.duration} ${product.warranty.unit || 'month'}${product.warranty.duration === 1 ? '' : 's'}`}{product.warranty.description && <small className="mt-1 block font-normal leading-relaxed text-slate-500">{product.warranty.description}</small>}</dd></>}
                </dl>
              </section>
            )}

            {(product.packages || []).length > 0 && (
              <section className="mt-5 rounded-2xl border border-slate-200 p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><PackageCheck className="h-4 w-4" style={{ color: 'var(--brand)' }} />Available pack hierarchy</h2>
                <p className="mt-1 text-xs text-slate-500">Packaging levels and quantities defined by the manufacturer.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">{product.packages.map((pack) => <div key={pack.code} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-700"><span><strong className="block text-slate-900">{pack.label}</strong><span className="font-mono text-[10px] uppercase text-slate-400">{pack.level || 'pack'} · {pack.code}</span></span><span className="text-right font-semibold">{pack.quantity} {pack.unitCode}{pack.containedPackageCode ? <small className="block font-normal text-slate-400">contains {pack.containedPackageCode}</small> : null}</span></div>)}</div>
              </section>
            )}

            {product.kind === 'bundle' && (product.bundleComponents || []).length > 0 && (
              <section className="mt-5 rounded-2xl border border-slate-200 p-4">
                <h2 className="text-sm font-semibold text-slate-800">What’s included</h2>
                <ul className="mt-3 space-y-2">{product.bundleComponents.map((component) => <li key={component._id || `${component.componentMasterId}-${component.selectionGroup}`} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"><span>{component.product?.title || 'Bundle item'}{component.variant && <span className="ml-1 text-slate-400">· {component.variant.displayLabel || component.variant.value}</span>}</span><span className="font-semibold">{component.quantity} {component.unitCode}</span></li>)}</ul>
              </section>
            )}

            {(product.compliance || []).length > 0 && (
              <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-900"><ShieldCheck className="h-4 w-4" />Verified standards & compliance</h2>
                <p className="mt-1 text-xs text-emerald-800/70">Only currently verified, unexpired records are shown.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">{product.compliance.map((record) => <div key={`${record.type}-${record.code}`} className="rounded-xl border border-emerald-100 bg-white p-3 shadow-sm"><p className="flex items-center gap-1.5 text-xs font-bold text-emerald-900"><BadgeCheck className="h-3.5 w-3.5" />{record.title}</p><p className="mt-1 font-mono text-[10px] text-emerald-700">{record.code}</p>{(record.authority || record.jurisdiction) && <p className="mt-1 text-[10px] text-slate-500">{[record.authority, record.jurisdiction].filter(Boolean).join(' · ')}</p>}{record.validUntil && <p className="mt-1 text-[10px] font-medium text-slate-400">Valid until {new Date(record.validUntil).toLocaleDateString('en-IN')}</p>}</div>)}</div>
              </section>
            )}
          </div>
        </div>

        {addons.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-4 font-display text-xl text-slate-900">{t(language, 'completeTheGift')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {addons.slice(0, 4).map((l) => (
                <ProductCard
                  key={l.listingId}
                  listing={l}
                  qtyByListing={qtyByListing}
                  busyId={busyId}
                  onAdd={add}
                  onQty={changeQty}
                />
              ))}
            </div>
          </section>
        )}

        {related.filter((l) => !addons.some((a) => String(a.listingId) === String(l.listingId))).length > 0 && (
          <section className="mt-14">
            <h2 className="mb-4 font-display text-xl text-slate-900">{t(language, 'youMayAlsoLike')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {related.filter((l) => !addons.some((a) => String(a.listingId) === String(l.listingId))).map((l) => (
                <ProductCard
                  key={l.listingId}
                  listing={l}
                  qtyByListing={qtyByListing}
                  busyId={busyId}
                  onAdd={add}
                  onQty={changeQty}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
