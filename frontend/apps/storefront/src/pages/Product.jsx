import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Droplets, Leaf, Scissors, Snowflake, Sun, Truck } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useShop } from '../store.js';
import { useCartActions } from '../lib/useCart.js';
import { t } from '../i18n.js';
import { recordViewed } from '../lib/viewed.js';
import ProductCard from '../components/ProductCard.jsx';
import FloralImage from '../components/FloralImage.jsx';
import ArrivalPromise from '../components/ArrivalPromise.jsx';
import { Button, Empty, Money, ProductSkeleton, Stepper } from '../components/ui.jsx';
import { errMsg } from '../lib/utils.js';

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
  const store = useShop((s) => s.store);
  const language = useShop((s) => s.language);
  const nextSlot = useShop((s) => s.nextSlot);
  const { qtyByListing, busyId, add, changeQty } = useCartActions();
  const [active, setActive] = useState(0);

  const { data, loading, error } = useApi(
    () => api.shop.productBySlug(slug),
    [slug]
  );

  const product = data?.product || {};
  const listing = data?.listing || {};
  const related = data?.related || [];
  const listingView = useMemo(() => ({
    listingId: listing.listingId || listing.id,
    price: listing.price,
    stockQty: listing.stockQty,
    product: {
      ...product,
      imageUrl: product.imageUrl || product.images?.[0]?.url,
    },
  }), [listing, product]);

  const images = product.images?.length
    ? product.images
    : product.imageUrl
      ? [{ url: product.imageUrl, altText: product.title, isPrimary: true }]
      : [];
  const attrs = attrMap(product.attributes);
  const vase = attrs.vase_life_days;
  const colour = attrs.color || attrs.colour;
  const stems = attrs.stem_count || attrs.stems;
  const care = attrs.care_notes?.value || (product.isPerishable ? CARE_DEFAULT : null);
  const price = listing.price?.sellingPrice ?? 0;
  const mrp = listing.price?.mrp ?? null;
  const stock = listing.stockQty ?? 0;
  const out = stock <= 0;
  const qty = qtyByListing.get(String(listingView.listingId))?.qty || 0;
  const tags = (product.tags || []).map((x) => String(x).toLowerCase());
  const occasions = tags.filter((x) => OCCASIONS.includes(x));
  const addons = related.filter((l) => ADDON_RE.test([
    l.product?.title, ...(l.product?.tags || []),
  ].filter(Boolean).join(' ')));

  useEffect(() => { setActive(0); }, [slug]);

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
      <JsonLd product={product} listing={listing} store={store} />
      <div className="wrap py-6">
        <Link to="/" className="mb-5 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ChevronLeft className="h-4 w-4" /> {t(language, 'backToShop')}
        </Link>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="aspect-square overflow-auto rounded-3xl bg-slate-50" style={{ touchAction: 'pan-x pinch-zoom' }}>
              {images[active]?.url ? (
                <FloralImage
                  src={images[active].url}
                  alt={images[active].altText || product.title}
                  priority
                  className="h-full w-full object-cover"
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
                    <FloralImage src={img.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col">
            {product.category?.name && (
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{product.category.name}</p>
            )}
            <h1 className="font-display mt-1 text-3xl tracking-tight text-slate-900 sm:text-4xl">{product.title}</h1>
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

            <div className="mt-4 flex items-end gap-2">
              <Money value={price} className="text-3xl font-bold text-slate-900" />
              {mrp && mrp > price && <Money value={mrp} strike className="pb-1 text-sm" />}
            </div>
            {product.defaultSellingUnit && (
              <p className="mt-1 text-xs text-slate-400">per {product.defaultSellingUnit}</p>
            )}

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

            <div className="mt-6">
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
                  qty={qtyByListing.get(String(l.listingId))?.qty || 0}
                  busy={busyId === l.listingId}
                  onAdd={add}
                  onQty={(q) => changeQty(l, q)}
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
                  qty={qtyByListing.get(String(l.listingId))?.qty || 0}
                  busy={busyId === l.listingId}
                  onAdd={add}
                  onQty={(q) => changeQty(l, q)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
