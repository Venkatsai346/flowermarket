import { Gift, Heart } from 'lucide-react';
import { isGiftMeaningful, occasionLabel } from '../lib/gift.js';

/** Customer-facing frozen gift snapshot on the order page. */
export default function GiftNote({ gift }) {
  if (!isGiftMeaningful(gift)) return null;
  return (
    <div className="card mt-4 overflow-hidden">
      <div
        className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide"
        style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)' }}
      >
        <Gift className="h-3.5 w-3.5" />
        {gift.isGift ? (occasionLabel(gift.occasion) || 'Gift') : 'Delivery note'}
      </div>
      <div className="space-y-2 p-4 text-sm text-slate-700">
        {gift.isGift && (
          <p>
            {gift.recipientName && <span>To <span className="font-semibold">{gift.recipientName}</span></span>}
            {gift.senderName && (
              <span>{gift.recipientName ? ' · ' : ''}From <span className="font-semibold">{gift.senderName}</span></span>
            )}
          </p>
        )}
        {gift.message && (
          <blockquote className="border-l-2 pl-3 italic leading-relaxed text-slate-600"
            style={{ borderColor: 'var(--brand)' }}>
            {gift.message}
          </blockquote>
        )}
        {gift.isGift && gift.hidePrices && (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Heart className="h-3.5 w-3.5" style={{ color: 'var(--brand)' }} />
            Price hidden from the recipient
          </p>
        )}
        {gift.deliveryInstructions && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-500">Rider note · </span>
            {gift.deliveryInstructions}
          </p>
        )}
      </div>
    </div>
  );
}
