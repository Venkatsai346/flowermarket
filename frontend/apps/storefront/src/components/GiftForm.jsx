import { Gift, Heart } from 'lucide-react';
import {
  GIFT_OCCASIONS, GIFT_INSTRUCTIONS_MAX, GIFT_MESSAGE_MAX, OCCASION_LABELS,
} from '../lib/gift.js';
import { cn } from '../lib/utils.js';

/**
 * Checkout gift identity — card text, recipient vs buyer, hide-prices, and
 * a delivery note that can exist without being a gift (gate codes).
 */
export default function GiftForm({ value, onChange, onPersist, addressName }) {
  const g = value;
  const set = (patch, persistNow = false) => {
    const next = { ...g, ...patch };
    onChange(next);
    if (persistNow) onPersist?.(next);
  };

  const toggleGift = () => {
    const on = !g.isGift;
    set({
      isGift: on,
      hidePrices: on ? (g.hidePrices !== false) : g.hidePrices,
      recipientName: on && !g.recipientName ? (addressName || '') : g.recipientName,
    }, true);
  };

  return (
    <section className="card p-5">
      <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-slate-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>2</span>
        Gift & delivery note
      </h2>
      <p className="mb-4 text-xs text-slate-500">
        The card is packed with the flowers. We freeze this text on the order so a later edit cannot rewrite it.
      </p>

      <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-slate-300"
          checked={g.isGift}
          onChange={toggleGift}
        />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Gift className="h-4 w-4" style={{ color: 'var(--brand)' }} />
            Send as a gift
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            Hide the price from the person at the door and print a card.
          </span>
        </span>
      </label>

      {g.isGift && (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Occasion</p>
            <div className="flex flex-wrap gap-1.5">
              {GIFT_OCCASIONS.map((o) => {
                const active = g.occasion === o;
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => set({ occasion: active ? null : o }, true)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium capitalize transition',
                      active ? 'border-transparent' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                    )}
                    style={active ? { background: 'var(--brand)', color: 'var(--brand-ink)' } : undefined}
                  >
                    {OCCASION_LABELS[o]}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Card message
            </span>
            <textarea
              value={g.message}
              maxLength={GIFT_MESSAGE_MAX}
              rows={3}
              onChange={(e) => set({ message: e.target.value })}
              onBlur={() => onPersist?.(g)}
              placeholder="Happy birthday — with love"
              className="input min-h-[88px] resize-y"
            />
            <span className="mt-1 block text-right text-[11px] text-slate-400">
              {(g.message || '').length}/{GIFT_MESSAGE_MAX}
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">From</span>
              <input
                value={g.senderName}
                maxLength={80}
                onChange={(e) => set({ senderName: e.target.value })}
                onBlur={() => onPersist?.(g)}
                placeholder="Your name on the card"
                className="input"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">To</span>
              <input
                value={g.recipientName}
                maxLength={80}
                onChange={(e) => set({ recipientName: e.target.value })}
                onBlur={() => onPersist?.(g)}
                placeholder={addressName || 'Recipient name'}
                className="input"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Recipient phone <span className="font-normal normal-case text-slate-400">(optional)</span>
            </span>
            <input
              value={g.recipientPhone}
              inputMode="tel"
              maxLength={16}
              onChange={(e) => set({ recipientPhone: e.target.value })}
              onBlur={() => onPersist?.(g)}
              placeholder="10-digit mobile if different from the address"
              className="input"
            />
          </label>

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300"
              checked={g.hidePrices !== false}
              onChange={(e) => set({ hidePrices: e.target.checked }, true)}
            />
            <span className="text-sm text-slate-700">
              <Heart className="mr-1 inline h-3.5 w-3.5" style={{ color: 'var(--brand)' }} />
              Don&apos;t mention the price to the recipient
            </span>
          </label>
        </div>
      )}

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Delivery instructions
        </span>
        <textarea
          value={g.deliveryInstructions}
          maxLength={GIFT_INSTRUCTIONS_MAX}
          rows={2}
          onChange={(e) => set({ deliveryInstructions: e.target.value })}
          onBlur={() => onPersist?.(g)}
          placeholder="Gate code, “call on arrival”, leave with security…"
          className="input min-h-[64px] resize-y"
        />
        <span className="mt-1 block text-right text-[11px] text-slate-400">
          {(g.deliveryInstructions || '').length}/{GIFT_INSTRUCTIONS_MAX}
        </span>
      </label>
    </section>
  );
}
