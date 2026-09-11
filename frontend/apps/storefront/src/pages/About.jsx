import { Link } from 'react-router-dom';
import {
  ChevronLeft, Clock, ExternalLink, Mail, MapPin,
  MessageCircle, Phone,
} from 'lucide-react';
import { useShop } from '../store.js';
import { t } from '../i18n.js';
import FloralImage from '../components/FloralImage.jsx';
import Testimonials from '../components/Testimonials.jsx';
import { HighlightIcon } from '../components/StoreHighlights.jsx';
import { Button } from '../components/ui.jsx';

/**
 * Store About page — the tenant's story (title/content/image/video), contact
 * card, values and customer love. Route: /about
 */
function videoEmbed(url) {
  if (!url) return null;
  const u = String(url).trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = u.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

function waLink(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}

const STATIC_VALUES = [
  { icon: 'leaf', title: 'Fresh, always', text: 'Every arrangement is made to order with farm-fresh stems. We never sell pre-made bouquets that have been sitting around.' },
  { icon: 'truck', title: 'Timed delivery', text: "Choose your delivery window at checkout. We deliver in slots so your flowers arrive when you're home to receive them." },
  { icon: 'shield', title: 'Happiness guarantee', text: "If your flowers don't arrive fresh, we'll replace them or refund you. No questions asked." },
];

export default function About() {
  const store = useShop((s) => s.store);
  const language = useShop((s) => s.language);

  if (!store) return null;

  const about = store.about || {};
  const contact = store.contact || {};
  const phone = contact.phone || store.phone;
  const email = contact.email || store.email;
  const address = contact.address || store.address;
  const hours = contact.hours || store.hours;
  const addressLine = address
    ? [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ')
    : null;

  const embed = videoEmbed(about.videoUrl);
  const heroImage = about.imageUrl || store.bannerUrl;
  const values = store.highlights?.length ? store.highlights : STATIC_VALUES;
  const paragraphs = String(about.content || '').split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="wrap py-6">
      <Link to="/" className="mb-5 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ChevronLeft className="h-4 w-4" /> {t(language, 'backToShop')}
      </Link>

      {/* Hero — video wins over image, image over nothing */}
      {embed ? (
        <div className="mb-8 overflow-hidden rounded-3xl bg-slate-900">
          <div className="aspect-video w-full">
            <iframe
              src={embed}
              title={`${store.name} — story`}
              className="h-full w-full"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      ) : about.videoUrl ? (
        <div className="mb-8 overflow-hidden rounded-3xl bg-slate-900">
          <video
            src={about.videoUrl}
            poster={about.imageUrl || undefined}
            controls
            playsInline
            preload="metadata"
            className="aspect-video w-full"
          />
        </div>
      ) : heroImage ? (
        <div className="mb-8 overflow-hidden rounded-3xl">
          <FloralImage
            src={heroImage}
            alt={store.name}
            className="h-48 w-full object-cover sm:h-64"
          />
        </div>
      ) : null}

      <div className="mx-auto max-w-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--brand)' }}>
          {t(language, 'ourStory')}
        </p>
        <h1 className="font-display mt-1 text-3xl tracking-tight text-slate-900 sm:text-4xl">
          {about.title || `About ${store.name}`}
        </h1>

        {store.tagline && !about.title && (
          <p className="mt-2 text-lg text-slate-600">{store.tagline}</p>
        )}

        {paragraphs.length > 0 ? (
          <div className="mt-4 space-y-4">
            {paragraphs.map((p, i) => (
              <p key={i} className="leading-relaxed text-slate-700">{p}</p>
            ))}
          </div>
        ) : store.description ? (
          <p className="mt-4 leading-relaxed text-slate-700">{store.description}</p>
        ) : null}

        {/* Contact */}
        {(phone || email || addressLine || hours || contact.whatsapp) && (
          <>
            <h2 className="font-display mt-10 text-xl text-slate-900">{t(language, 'contactUs')}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {phone && (
                <a href={`tel:${phone.replace(/\s/g, '')}`} className="card flex items-start gap-3 p-4 transition hover:shadow-lift">
                  <Phone className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--brand)' }} />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{t(language, 'callUs')}</span>
                    <span className="block text-sm text-slate-600">{phone}</span>
                  </span>
                </a>
              )}
              {email && (
                <a href={`mailto:${email}`} className="card flex items-start gap-3 p-4 transition hover:shadow-lift">
                  <Mail className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--brand)' }} />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{t(language, 'emailUs')}</span>
                    <span className="block break-all text-sm text-slate-600">{email}</span>
                  </span>
                </a>
              )}
              {addressLine && (
                <div className="card flex items-start gap-3 p-4 sm:col-span-2">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--brand)' }} />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{t(language, 'visitUs')}</span>
                    <span className="block text-sm text-slate-600">{addressLine}</span>
                    {contact.mapUrl && (
                      <a
                        href={contact.mapUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-bold hover:underline"
                        style={{ color: 'var(--brand)' }}
                      >
                        {t(language, 'getDirections')} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </span>
                </div>
              )}
              {hours && (
                <div className="card flex items-start gap-3 p-4">
                  <Clock className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--brand)' }} />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">{t(language, 'openHours')}</span>
                    <span className="block text-sm text-slate-600">{hours}</span>
                  </span>
                </div>
              )}
              {contact.whatsapp && waLink(contact.whatsapp) && (
                <a
                  href={waLink(contact.whatsapp)}
                  target="_blank"
                  rel="noreferrer"
                  className="card flex items-start gap-3 p-4 transition hover:shadow-lift"
                >
                  <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">WhatsApp</span>
                    <span className="block text-sm text-slate-600">{contact.whatsapp}</span>
                  </span>
                </a>
              )}
            </div>
          </>
        )}

        {/* Values — tenant highlights when set, house copy otherwise */}
        <div className="mt-10">
          <h2 className="font-display text-xl text-slate-900">Why shop with us</h2>
          <div className="mt-4 space-y-4">
            {values.map((v, i) => (
              <div key={`${v.title}-${i}`} className="flex items-start gap-3">
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  <HighlightIcon name={v.icon} className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-medium text-slate-900">{v.title}</p>
                  {v.text && <p className="text-sm text-slate-600">{v.text}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-10 flex gap-3">
          <Link to="/">
            <Button>Shop now</Button>
          </Link>
          <Link to="/orders">
            <Button variant="secondary">My orders</Button>
          </Link>
        </div>
      </div>

      {store.testimonials?.length > 0 && (
        <div className="mx-auto mt-12 max-w-4xl">
          <Testimonials items={store.testimonials} title={t(language, 'lovedByCustomers')} />
        </div>
      )}

    </div>
  );
}
