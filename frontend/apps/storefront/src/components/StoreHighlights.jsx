import {
  BadgeCheck, Clock, Flower2, Gift, Heart, Leaf, MapPin, Package,
  RefreshCcw, Shield, Sparkles, Star, Truck, Wallet,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

/**
 * Trust-badge row. Tenants pick an icon NAME in the console (free text, so a
 * typo must degrade to a flower — never to a crash or a blank hole).
 */
const ICONS = {
  leaf: Leaf,
  truck: Truck,
  shield: Shield,
  clock: Clock,
  star: Star,
  heart: Heart,
  gift: Gift,
  sparkles: Sparkles,
  flower: Flower2,
  flowers: Flower2,
  badge: BadgeCheck,
  verified: BadgeCheck,
  package: Package,
  refresh: RefreshCcw,
  returns: RefreshCcw,
  wallet: Wallet,
  pin: MapPin,
  location: MapPin,
};

export function HighlightIcon({ name, className }) {
  const Icon = ICONS[String(name || '').toLowerCase().trim()] || Flower2;
  return <Icon className={className} />;
}

export default function StoreHighlights({ items = [], className }) {
  if (!items.length) return null;
  const cols = items.length >= 5 ? 'lg:grid-cols-6' : items.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3';
  return (
    <section aria-label="Why shop with us" className={className}>
      <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', cols)}>
        {items.map((h, i) => (
          <div
            key={`${h.title}-${i}`}
            className="card flex flex-col items-center gap-1.5 px-3 py-5 text-center"
          >
            <span
              className="mb-1 grid h-11 w-11 place-items-center rounded-full"
              style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
            >
              <HighlightIcon name={h.icon} className="h-5 w-5" />
            </span>
            <p className="text-sm font-bold text-slate-900">{h.title}</p>
            {h.text && <p className="text-xs leading-relaxed text-slate-500">{h.text}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
