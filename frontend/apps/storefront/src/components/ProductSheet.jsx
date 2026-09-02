import { Leaf, Snowflake, Truck } from 'lucide-react';
import { Button, Money, Sheet, Stepper } from './ui.jsx';

export default function ProductSheet({ listing, qty, onClose, onAdd, onQty }) {
  const p = listing.product || {};
  const price = listing.price?.sellingPrice ?? 0;
  const mrp = listing.price?.mrp ?? null;
  const stock = listing.stockQty ?? 0;
  const out = stock <= 0;

  return (
    <Sheet
      open
      onClose={onClose}
      side="bottom"
      title={p.title}
      subtitle={p.shortDescription || undefined}
      footer={out ? (
        <Button className="w-full" variant="outline" disabled>Out of stock</Button>
      ) : qty > 0 ? (
        <div className="flex items-center justify-between">
          <Stepper value={qty} onChange={onQty} max={Math.min(stock, 20)} />
          <Button variant="soft" onClick={onClose}>Done</Button>
        </div>
      ) : (
        <Button className="w-full" onClick={() => { onAdd(listing); onClose(); }}>
          Add to basket · <Money value={price} />
        </Button>
      )}
    >
      <div className="space-y-4">
        <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-50">
          {p.imageUrl
            ? <img src={p.imageUrl} alt={p.title} className="h-full w-full object-cover" />
            : <span className="flex h-full w-full items-center justify-center text-6xl" style={{ background: 'var(--brand-soft)' }} aria-hidden>🌸</span>}
        </div>

        <div className="flex items-end gap-2">
          <Money value={price} className="text-2xl font-bold text-slate-900" />
          {mrp && mrp > price && <Money value={mrp} strike className="pb-0.5 text-sm" />}
        </div>

        <div className="flex flex-wrap gap-2">
          {p.isPerishable && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <Leaf className="h-3.5 w-3.5" />Fresh · perishable
            </span>
          )}
          {p.requiresColdChain && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
              <Snowflake className="h-3.5 w-3.5" />Cold chain
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            <Truck className="h-3.5 w-3.5" />Slot delivery
          </span>
        </div>

        {p.description && <p className="text-sm leading-relaxed text-slate-600">{p.description}</p>}

        {!out && stock <= 5 && (
          <p className="text-sm font-medium text-amber-600">Only {stock} left in stock</p>
        )}
      </div>
    </Sheet>
  );
}
