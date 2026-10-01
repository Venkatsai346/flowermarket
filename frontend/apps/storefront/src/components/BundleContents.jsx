import { Boxes, CheckCircle2, Layers3, PackageCheck, ShoppingBag, Sparkles } from 'lucide-react';
import ProductFallback from './ProductFallback.jsx';
import ProductImage from './ProductImage.jsx';
import { Money } from './ui.jsx';
import { cn } from '../lib/utils.js';

const words = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const variantName = (variant) => variant?.displayLabel
  || (variant?.optionValues || []).map((option) => option.value).filter(Boolean).join(' · ')
  || variant?.value
  || null;

function ComponentMedia({ component }) {
  const media = component.media;
  const src = media?.url || component.product?.imageUrl;
  const alt = media?.altText || component.product?.title || 'Bundle component';
  if (media?.mediaType === 'video' && src) {
    return <video src={src} aria-label={alt} className="h-full w-full object-cover" controls preload="metadata" playsInline />;
  }
  if (media && !['image', undefined, null].includes(media.mediaType)) {
    return <ProductFallback label={`${words(media.mediaType)} preview for ${alt}`} />;
  }
  return <ProductImage src={src} alt={alt} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />;
}

function Detail({ label, value }) {
  if (!value) return null;
  return <div><dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</dt><dd className="mt-0.5 text-xs font-semibold text-slate-700">{value}</dd></div>;
}

/** Rich, factual merchandising for the active component graph of a bundle. */
export default function BundleContents({ components = [] }) {
  if (!components.length) return null;
  const exactVariants = components.filter((component) => component.variant).length;
  const selectionGroups = new Set(components.map((component) => component.selectionGroup || 'included')).size;

  return (
    <section aria-labelledby="bundle-contents-title" className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className="relative overflow-hidden bg-slate-950 px-5 py-6 text-white sm:px-6">
        <span className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/5" aria-hidden />
        <span className="absolute -bottom-20 left-1/3 h-44 w-44 rounded-full" style={{ background: 'var(--brand)', opacity: 0.12 }} aria-hidden />
        <div className="relative flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/10"><Boxes className="h-5 w-5" style={{ color: 'var(--brand-soft)' }} /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Bundle composition</p>
            <h2 id="bundle-contents-title" className="mt-1 font-display text-xl">What’s in this bundle, clearly detailed</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/60">See the included products, available component options, exact variants and quantities before you add the bundle to your basket.</p>
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10"><PackageCheck className="h-4 w-4 text-emerald-300" /><strong className="mt-2 block text-sm">{components.length}</strong><span className="block text-[10px] text-white/50">component{components.length === 1 ? '' : 's'}</span></div>
          <div className="rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10"><Layers3 className="h-4 w-4 text-sky-300" /><strong className="mt-2 block text-sm">{exactVariants}</strong><span className="block text-[10px] text-white/50">exact variant{exactVariants === 1 ? '' : 's'}</span></div>
          <div className="rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10"><ShoppingBag className="h-4 w-4 text-violet-300" /><strong className="mt-2 block text-sm">{selectionGroups}</strong><span className="block text-[10px] text-white/50">component group{selectionGroups === 1 ? '' : 's'}</span></div>
        </div>
      </header>

      <div className="p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {components.map((component, index) => {
            const product = component.product || {};
            const variant = component.variant || null;
            const label = variantName(variant);
            const group = component.selectionGroup || 'included';
            const componentState = group === 'included' ? 'Included' : component.defaultSelected ? 'Default choice' : 'Available choice';
            const warranty = product.warranty?.duration != null
              ? `${product.warranty.duration} ${product.warranty.unit || 'month'}${product.warranty.duration === 1 ? '' : 's'}`
              : null;
            return (
              <article key={component.id || `${component.componentMasterId}-${group}-${index}`} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition duration-300 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg">
                <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
                  <ComponentMedia component={component} />
                  <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-slate-950/85 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm backdrop-blur">{component.quantity} {component.unitCode}</span>
                    <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-bold shadow-sm backdrop-blur', group === 'included' ? 'bg-emerald-50/95 text-emerald-700' : 'bg-amber-50/95 text-amber-700')}>{componentState}</span>
                  </div>
                  {(component.media?.url || product.imageUrl) && <span className="absolute bottom-3 right-3 rounded-full bg-white/90 px-2 py-1 text-[9px] font-semibold text-slate-500 shadow-sm backdrop-blur">{component.media?.source === 'variant' ? 'Variant media' : 'Product media'}</span>}
                </div>

                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-100 text-xs font-black text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold leading-snug text-slate-900">{product.title || 'Bundle component'}</h3>
                      {label && <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--brand)' }}><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{label}</p>}
                    </div>
                  </div>

                  {(variant?.optionValues || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">{variant.optionValues.map((option) => <span key={`${option.code}-${option.value}`} className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{option.name || words(option.code)}: {option.value}</span>)}</div>
                  )}
                  {product.shortDescription && <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-slate-500">{product.shortDescription}</p>}

                  {(product.manufacturer || product.modelNumber || product.countryOfOrigin || warranty || (product.condition && product.condition !== 'new')) && (
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                      <Detail label="Maker" value={product.manufacturer} />
                      <Detail label="Model" value={product.modelNumber} />
                      <Detail label="Origin" value={product.countryOfOrigin} />
                      <Detail label="Condition" value={product.condition && product.condition !== 'new' ? words(product.condition) : null} />
                      <Detail label="Warranty" value={warranty} />
                    </dl>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-[10px]">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">{group === 'included' ? 'Core bundle' : words(group)}</span>
                    {group !== 'included' && <span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-700">{component.required === false ? 'Optional selection' : 'Required selection'}</span>}
                    {Number(component.priceAdjustment) !== 0 && <span className="ml-auto font-bold text-slate-700">{Number(component.priceAdjustment) > 0 ? '+' : '−'}<Money value={Math.abs(Number(component.priceAdjustment))} /></span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-700"><Sparkles className="h-4 w-4" style={{ color: 'var(--brand)' }} />Why choose the bundle</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div><CheckCircle2 className="h-4 w-4 text-emerald-500" /><strong className="mt-2 block text-xs text-slate-800">Complete set</strong><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Included components are organized together under one clear bundle listing.</p></div>
            <div><Layers3 className="h-4 w-4 text-sky-500" /><strong className="mt-2 block text-xs text-slate-800">Clear specifications</strong><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Exact variant details are shown wherever this bundle pins a particular option.</p></div>
            <div><ShoppingBag className="h-4 w-4 text-violet-500" /><strong className="mt-2 block text-xs text-slate-800">One convenient purchase</strong><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Add the assembled set without finding every included product separately.</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}
