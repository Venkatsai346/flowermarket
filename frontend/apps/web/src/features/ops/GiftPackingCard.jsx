import { Gift, Heart, Printer } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';

/**
 * What the picker writes on the enclosure card. Prices never appear here —
 * ops totals stay on the order drawer. Print is the packing-station path.
 */
export default function GiftPackingCard({ gift, packingCard }) {
  const g = packingCard || gift;
  if (!g || !(g.isGift || g.deliveryInstructions || g.message)) return null;

  const print = () => {
    const w = window.open('', '_blank', 'noopener,width=480,height=640');
    if (!w) return;
    const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]));
    w.document.write(`<!doctype html><html><head><title>Gift card</title>
      <style>
        body { font-family: Georgia, serif; padding: 32px; color: #1e293b; }
        h1 { font-size: 14px; letter-spacing: .14em; text-transform: uppercase; color: #be123c; }
        .msg { font-size: 18px; line-height: 1.5; font-style: italic; margin: 24px 0; }
        .meta { font-size: 13px; color: #475569; }
        .note { margin-top: 24px; font-size: 12px; border-top: 1px dashed #e2e8f0; padding-top: 12px; }
      </style></head><body>
      <h1>${esc(g.headline || (g.isGift ? 'Gift' : 'Delivery note'))}</h1>
      ${g.to ? `<p class="meta">To ${esc(g.to)}</p>` : ''}
      ${g.from ? `<p class="meta">From ${esc(g.from)}</p>` : ''}
      ${g.message ? `<p class="msg">${esc(g.message)}</p>` : ''}
      ${g.hidePrices ? '<p class="note">Do not mention the price at the door.</p>' : ''}
      ${g.deliveryInstructions ? `<p class="note">Rider: ${esc(g.deliveryInstructions)}</p>` : ''}
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-rose-600" />
          <p className="text-sm font-semibold text-slate-800">
            {g.headline || (g.isGift ? 'Gift card' : 'Delivery note')}
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={Printer} onClick={print}>Print card</Button>
      </div>
      <div className="space-y-1.5 text-sm text-slate-700">
        {g.to && <p>To <span className="font-medium">{g.to}</span></p>}
        {g.from && <p>From <span className="font-medium">{g.from}</span></p>}
        {g.message && (
          <blockquote className="border-l-2 border-rose-300 pl-3 italic leading-relaxed text-slate-600">
            {g.message}
          </blockquote>
        )}
        {g.hidePrices && (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700">
            <Heart className="h-3.5 w-3.5" /> Do not mention the price at the door
          </p>
        )}
        {g.deliveryInstructions && (
          <p className="rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-600">
            Rider · {g.deliveryInstructions}
          </p>
        )}
      </div>
    </div>
  );
}
