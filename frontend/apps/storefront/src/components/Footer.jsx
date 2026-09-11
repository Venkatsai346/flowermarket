import { Link } from 'react-router-dom';
import { Facebook, Globe, Instagram, Mail, MapPin, Phone, Twitter, Youtube } from 'lucide-react';
import { useShop } from '../store.js';
import { t } from '../i18n.js';

const SOCIAL_ICONS = [
  ['instagram', Instagram, 'Instagram'],
  ['facebook', Facebook, 'Facebook'],
  ['twitter', Twitter, 'Twitter'],
  ['youtube', Youtube, 'YouTube'],
  ['website', Globe, 'Website'],
];

export default function Footer() {
  const store = useShop((s) => s.store);
  const language = useShop((s) => s.language);
  const social = store?.socialLinks || {};
  const contact = store?.contact || {};
  const address = contact.address || store?.address;
  const addressLine = address
    ? [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ')
    : null;
  const phone = contact.phone || store?.phone;
  const email = contact.email || store?.email;
  const socials = SOCIAL_ICONS.filter(([key]) => social[key]);

  return (
    <footer
      className="mt-16 border-t border-slate-200/70 py-10"
      style={{ backgroundImage: 'var(--paper)', backgroundSize: 'cover', backgroundPosition: 'center' }}
    >
      <div className="wrap">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-display text-lg tracking-tight text-slate-800">{store?.name}</p>
            {store?.tagline && <p className="mt-1 text-xs leading-relaxed text-slate-500">{store.tagline}</p>}
            {socials.length > 0 && (
              <p className="mt-3 flex gap-2">
                {socials.map(([key, Icon, label]) => (
                  <a
                    key={key}
                    href={social[key]}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${store?.name} on ${label}`}
                    className="grid h-9 w-9 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 transition hover:ring-2"
                    style={{ '--tw-ring-color': 'var(--brand)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--brand)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = ''; }}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </p>
            )}
          </div>

          <nav aria-label={t(language, 'quickLinks')}>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              {t(language, 'quickLinks')}
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li><Link to="/" className="hover:underline">{t(language, 'shop')}</Link></li>
              <li><Link to="/categories" className="hover:underline">{t(language, 'categories')}</Link></li>
              <li><Link to="/brands" className="hover:underline">{t(language, 'brands')}</Link></li>
              <li><Link to="/browse" className="hover:underline">{t(language, 'browseAllProducts')}</Link></li>
            </ul>
          </nav>

          <nav aria-label={t(language, 'companyLinks')}>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              {t(language, 'companyLinks')}
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li><Link to="/about" className="hover:underline">{t(language, 'about')}</Link></li>
              <li><Link to="/orders" className="hover:underline">{t(language, 'myOrders')}</Link></li>
              <li><Link to="/wishlist" className="hover:underline">{t(language, 'wishlist')}</Link></li>
              <li>
                <Link to="/sell" className="hover:underline">
                  Sell on {store?.name || 'this marketplace'}
                </Link>
              </li>
            </ul>
          </nav>

          {(phone || email || addressLine) && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {t(language, 'contactUs')}
              </p>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {addressLine && (
                  <li className="flex gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <span>{addressLine}</span>
                  </li>
                )}
                {phone && (
                  <li>
                    <a href={`tel:${phone.replace(/\s/g, '')}`} className="flex gap-2 hover:underline">
                      <Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <span>{phone}</span>
                    </a>
                  </li>
                )}
                {email && (
                  <li>
                    <a href={`mailto:${email}`} className="flex gap-2 hover:underline">
                      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <span className="break-all">{email}</span>
                    </a>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-col items-center gap-2 border-t border-slate-200/70 pt-6 text-center">
          {store?.gstin && (
            <p className="text-[11px] font-medium tracking-[0.14em] text-slate-400">
              {t(language, 'gstin')} {store.gstin}
            </p>
          )}
          {store?.footerText && (
            <p className="max-w-xl text-[11px] leading-relaxed text-slate-400">{store.footerText}</p>
          )}
          <p className="text-[11px] text-slate-400">{t(language, 'pricesInclusive')}</p>
          <p className="text-[11px] text-slate-400">
            © {new Date().getFullYear()} {store?.name}. {t(language, 'allRights')}
          </p>
        </div>
      </div>
    </footer>
  );
}
