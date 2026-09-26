import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, MapPin, PackageSearch, Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { useCartActions } from '../lib/useCart.js';
import ProductCard from '../components/ProductCard.jsx';
import FloralImage from '../components/FloralImage.jsx';
import { Button, Empty, ProductSkeleton } from '../components/ui.jsx';
import { errMsg } from '../lib/utils.js';

export default function Brand() {
  const { id } = useParams();
  const { qtyByListing, busyId, add, changeQty } = useCartActions();
  const brands = useApi(() => api.shop.storeBrands(), []);
  const products = useApi(() => api.shop.products({ brandId: id, limit: 48 }), [id]);
  const brand = (brands.data || []).find((item) => String(item.id) === String(id));
  const items = products.data || [];

  if (!brands.loading && !brand) {
    return <div className="wrap py-14"><Empty floral title="Brand not available" message="This brand has no currently available products at this store." action={<Button variant="soft" onClick={() => window.location.assign('/brands')}>Browse brands</Button>} /></div>;
  }

  return (
    <div className="wrap py-6">
      <Link to="/brands" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900"><ArrowLeft className="h-4 w-4" />All brands</Link>
      <header className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 text-white shadow-sm">
        <div className="relative h-40 overflow-hidden sm:h-56">
          {brand?.bannerUrl ? <FloralImage src={brand.bannerUrl} alt="" className="h-full w-full object-cover opacity-75" /> : <div className="h-full w-full" style={{ background: 'linear-gradient(135deg, var(--brand), #0f172a)' }} />}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
        </div>
        <div className="relative -mt-12 flex flex-col gap-4 px-5 pb-6 sm:flex-row sm:items-end sm:px-8 sm:pb-8">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-3xl border-4 border-slate-950 bg-white text-2xl font-black" style={{ color: 'var(--brand)' }}>
            {brand?.logoUrl ? <img src={brand.logoUrl} alt="" className="h-full w-full object-contain" /> : brand?.name?.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50"><Sparkles className="h-3 w-3" />Brand collection</p>
            <h1 className="flex items-center gap-2 font-display text-3xl sm:text-4xl">{brand?.name || 'Loading…'}{brand?.isVerified && <BadgeCheck className="h-6 w-6 text-sky-400" aria-label="Verified brand" />}</h1>
            {brand?.tagline && <p className="mt-1 max-w-2xl text-sm text-white/70">{brand.tagline}</p>}
            {(brand?.headquarters || brand?.foundedYear) && <p className="mt-2 flex items-center gap-1.5 text-xs text-white/50"><MapPin className="h-3.5 w-3.5" />{[brand.headquarters, brand.foundedYear ? `Since ${brand.foundedYear}` : null].filter(Boolean).join(' · ')}</p>}
          </div>
          <p className="shrink-0 text-xs font-semibold text-white/60">{brand?.productCount ?? items.length} available</p>
        </div>
      </header>

      {brand?.description && <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-7 text-slate-600">{brand.description}</p>}

      <section className="mt-9">
        <div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--brand)' }}>Available now</p><h2 className="font-display text-2xl text-slate-900">Shop {brand?.name}</h2></div><span className="text-xs text-slate-400">{products.loading ? 'Loading…' : `${items.length} results`}</span></div>
        {products.loading && !products.data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <ProductSkeleton key={index} />)}</div>
        ) : products.error ? (
          <Empty floral icon={PackageSearch} title="Could not load this collection" message={errMsg(products.error)} action={<Button variant="soft" onClick={products.refetch}>Retry</Button>} />
        ) : items.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{items.map((listing) => <ProductCard key={listing.masterId || listing.listingId} listing={listing} qtyByListing={qtyByListing} busyId={busyId} onAdd={add} onQty={changeQty} />)}</div>
        ) : <Empty floral icon={PackageSearch} title="Nothing available right now" message="Check back soon for new products from this brand." />}
      </section>
    </div>
  );
}
