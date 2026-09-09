import { Link } from 'react-router-dom';
import { Heart, Trash2, ShoppingBag } from 'lucide-react';
import { useWishlist } from '../lib/useWishlist.js';
import FloralImage from '../components/FloralImage.jsx';
import { Empty, Button } from '../components/ui.jsx';
import { t } from '../i18n.js';
import { useShop } from '../store.js';

export default function Wishlist() {
  const language = useShop((s) => s.language);
  const { items, toggle, clear } = useWishlist();

  if (items.length === 0) {
    return (
      <div className="wrap py-12">
        <Empty
          floral
          icon={Heart}
          title={t(language, 'wishlistEmpty') || 'Your wishlist is empty'}
          message={t(language, 'wishlistEmptyMsg') || 'Save items you love and come back to them anytime.'}
          action={
            <Link to="/">
              <Button variant="soft">{t(language, 'continueShopping') || 'Continue shopping'}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="wrap py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-slate-900">
            {t(language, 'wishlist') || 'Wishlist'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {items.length} {items.length === 1 ? 'item' : 'items'} saved
          </p>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="text-sm font-medium text-red-500 hover:text-red-600"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.slug} className="group relative">
            <Link to={`/p/${item.slug}`} className="block">
              <span className="block aspect-square overflow-hidden rounded-2xl bg-slate-100">
                <FloralImage
                  src={item.imageUrl}
                  alt={item.title}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </span>
              <span className="mt-2 block line-clamp-2 text-sm font-medium text-slate-800">
                {item.title}
              </span>
              {item.price != null && (
                <span className="mt-0.5 block text-sm font-bold text-slate-900">
                  ₹{Number(item.price).toLocaleString('en-IN')}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => toggle(item)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-red-500 shadow-sm backdrop-blur transition hover:bg-white"
              aria-label="Remove from wishlist"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
