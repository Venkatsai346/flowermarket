import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Star } from 'lucide-react';
import FloralImage from './FloralImage.jsx';
import { Money } from './ui.jsx';

/**
 * Rich brand card — banner, overlapping logo, verified/featured badges,
 * tagline, live product count + from-price, all linking into a
 * brand-filtered listing.
 */
export default function BrandCard({ brand }) {
  if (!brand) return null;
  const to = `/search?brand=${brand.id}&brandName=${encodeURIComponent(brand.name || '')}`;
  const count = Number(brand.productCount) || 0;

  return (
    <Link
      to={to}
      className="card group flex flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-transparent"
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 12px 32px -12px var(--brand-ring)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = ''; }}
      aria-label={`Shop ${brand.name} — ${count} product${count === 1 ? '' : 's'}`}
    >
      <span className="relative block h-24 overflow-hidden bg-slate-100 sm:h-28">
        {brand.bannerUrl ? (
          <FloralImage
            src={brand.bannerUrl}
            alt=""
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <span
            className="block h-full w-full"
            style={{ background: 'linear-gradient(135deg, var(--brand-soft), var(--brand-ring))' }}
          />
        )}
        <span className="absolute left-3 top-3 flex gap-1.5">
          {brand.isFeatured && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Featured
            </span>
          )}
        </span>
      </span>

      <span className="flex flex-1 flex-col px-4 pb-4">
        <span className="-mt-7 mb-2 block h-14 w-14 overflow-hidden rounded-2xl bg-white object-cover ring-4 ring-white">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
          ) : (
            <span
              className="grid h-full w-full place-items-center text-xl font-bold"
              style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
            >
              {(brand.name || '?').trim().charAt(0).toUpperCase()}
            </span>
          )}
        </span>

        <span className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
          <span className="truncate">{brand.name}</span>
          {brand.isVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-500" aria-label="Verified brand" />}
        </span>
        {brand.tagline && (
          <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{brand.tagline}</span>
        )}
        {(brand.headquarters || brand.foundedYear) && (
          <span className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {[brand.headquarters, brand.foundedYear ? `since ${brand.foundedYear}` : null].filter(Boolean).join(' · ')}
          </span>
        )}

        <span className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
          <span className="font-semibold text-slate-600">
            {count} product{count === 1 ? '' : 's'}
            {brand.fromPrice != null && (
              <span className="text-slate-400">
                {' '}· from <Money value={brand.fromPrice} className="font-bold text-slate-700" />
              </span>
            )}
          </span>
          <span
            className="inline-flex items-center gap-1 font-bold transition group-hover:gap-2"
            style={{ color: 'var(--brand)' }}
          >
            Shop <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </span>
      </span>
    </Link>
  );
}
