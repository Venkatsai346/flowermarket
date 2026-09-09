import { Link } from 'react-router-dom';
import { ChevronLeft, MapPin, Phone, Mail, Clock, Truck, Shield, Leaf } from 'lucide-react';
import { useShop } from '../store.js';
import FloralImage from '../components/FloralImage.jsx';
import { Button } from '../components/ui.jsx';

/**
 * Store About page — tells the store's story, delivery policies, and values.
 * Route: /about
 */
export default function About() {
  const store = useShop((s) => s.store);
  const theme = useShop((s) => s.theme);

  if (!store) return null;

  return (
    <div className="wrap py-6">
      <Link to="/" className="mb-5 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ChevronLeft className="h-4 w-4" /> Back to shop
      </Link>

      {/* Hero */}
      {store.bannerUrl && (
        <div className="mb-8 overflow-hidden rounded-3xl">
          <FloralImage
            src={store.bannerUrl}
            alt={store.name}
            className="h-48 w-full object-cover sm:h-64"
          />
        </div>
      )}

      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-3xl tracking-tight text-slate-900 sm:text-4xl">
          About {store.name}
        </h1>

        {store.tagline && (
          <p className="mt-2 text-lg text-slate-600">{store.tagline}</p>
        )}

        {store.description && (
          <p className="mt-4 leading-relaxed text-slate-700">{store.description}</p>
        )}

        {/* Store info cards */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {store.phone && (
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4">
              <Phone className="mt-0.5 h-5 w-5 text-rose-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">Phone</p>
                <p className="text-sm text-slate-600">{store.phone}</p>
              </div>
            </div>
          )}
          {store.email && (
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4">
              <Mail className="mt-0.5 h-5 w-5 text-rose-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">Email</p>
                <p className="text-sm text-slate-600">{store.email}</p>
              </div>
            </div>
          )}
          {store.address && (
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4">
              <MapPin className="mt-0.5 h-5 w-5 text-rose-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">Address</p>
                <p className="text-sm text-slate-600">
                  {[store.address.line1, store.address.line2, store.address.city, store.address.state, store.address.pincode]
                    .filter(Boolean).join(', ')}
                </p>
              </div>
            </div>
          )}
          {store.hours && (
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4">
              <Clock className="mt-0.5 h-5 w-5 text-rose-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">Hours</p>
                <p className="text-sm text-slate-600">{store.hours}</p>
              </div>
            </div>
          )}
        </div>

        {/* Values */}
        <div className="mt-10">
          <h2 className="font-display text-xl text-slate-900">Why shop with us</h2>
          <div className="mt-4 space-y-4">
            <div className="flex items-start gap-3">
              <Leaf className="mt-0.5 h-5 w-5 text-emerald-500" />
              <div>
                <p className="font-medium text-slate-900">Fresh, always</p>
                <p className="text-sm text-slate-600">
                  Every arrangement is made to order with farm-fresh stems. We never sell pre-made bouquets that have been sitting around.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Truck className="mt-0.5 h-5 w-5 text-sky-500" />
              <div>
                <p className="font-medium text-slate-900">Timed delivery</p>
                <p className="text-sm text-slate-600">
                  Choose your delivery window at checkout. We deliver in slots so your flowers arrive when you're home to receive them.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Shield className="mt-0.5 h-5 w-5 text-violet-500" />
              <div>
                <p className="font-medium text-slate-900">Happiness guarantee</p>
                <p className="text-sm text-slate-600">
                  If your flowers don't arrive fresh, we'll replace them or refund you. No questions asked.
                </p>
              </div>
            </div>
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
    </div>
  );
}
