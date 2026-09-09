import { Link } from 'react-router-dom';
import { useShop } from '../store.js';
import { t } from '../i18n.js';

export default function Footer() {
  const store = useShop((s) => s.store);
  const language = useShop((s) => s.language);
  const social = store?.socialLinks || {};

  return (
    <footer
      className="mt-16 border-t border-slate-200/70 py-10"
      style={{ backgroundImage: 'var(--paper)', backgroundSize: 'cover', backgroundPosition: 'center' }}
    >
      <div className="wrap flex flex-col items-center gap-3 text-center">
        <p className="font-display text-lg tracking-tight text-slate-800">{store?.name}</p>
        {store?.tagline && <p className="text-xs text-slate-500">{store.tagline}</p>}
        <nav className="flex flex-wrap justify-center gap-4 text-xs text-slate-500" aria-label="Footer">
          <Link to="/" className="hover:text-slate-800">Shop</Link>
          <Link to="/browse" className="hover:text-slate-800">Browse</Link>
          <Link to="/about" className="hover:text-slate-800">About</Link>
          <Link to="/orders" className="hover:text-slate-800">Orders</Link>
          <Link to="/wishlist" className="hover:text-slate-800">Wishlist</Link>
        </nav>
        {store?.gstin && (
          <p className="mt-2 text-[11px] font-medium tracking-[0.14em] text-slate-400">
            {t(language, 'gstin')} {store.gstin}
          </p>
        )}
        <p className="text-[11px] text-slate-400">{t(language, 'pricesInclusive')}</p>
        {(social.instagram || social.facebook || social.website) && (
          <p className="mt-2 flex gap-3 text-xs text-slate-500">
            {social.instagram && <a href={social.instagram} className="hover:text-slate-800">Instagram</a>}
            {social.facebook && <a href={social.facebook} className="hover:text-slate-800">Facebook</a>}
            {social.website && <a href={social.website} className="hover:text-slate-800">Website</a>}
          </p>
        )}
      </div>
    </footer>
  );
}
