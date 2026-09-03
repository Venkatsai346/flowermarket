import { useMemo, useState } from 'react';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import { useShop } from '../store.js';
import { Button, Sheet, Stepper, Empty } from './ui.jsx';
import { cn, errMsg } from '../lib/utils.js';
import {
  INSTANT_CLAIM_WINDOW_HOURS, RETURN_WINDOW_DAYS, RETURN_CLAIM_META, RETURN_REASONS,
  canPickupReturn, remainingQty,
} from '../lib/afterSales.js';

/**
 * ReturnSheet — the customer-facing "request a return" form.
 *
 * ── Server is the authority, but the client helps them get it right ────────
 * Eligibility (window, returnable qty, fraud guard) is checked on the server
 * and can only be changed there. This sheet only does the two things a client
 * is good at: let the customer say *what* and *why* without making them type a
 * form of JSON, and surface a server refusal in human words.
 */
export default function ReturnSheet({ order, items = [], open, onClose, onCreated }) {
  const toast = useShop((s) => s.toast);
  const [claimType, setClaimType] = useState('pickup_qc');
  const [qtyMap, setQtyMap] = useState({});
  const [reasonCode, setReasonCode] = useState(RETURN_REASONS[0].code);
  const [reasonText, setReasonText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState(null);

  const lines = useMemo(
    () => (items || []).map((it) => ({ ...it, remaining: remainingQty(it) })).filter((it) => it.remaining > 0),
    [items]
  );

  const totalQty = lines.reduce((sum, it) => sum + (qtyMap[it.id] || 0), 0);
  const hasSelected = totalQty > 0;

  // Fresh items that cannot go through pickup return default to the instant claim.
  const allInstantOnly = lines.length > 0 && lines.every((it) => !it.isReturnable);
  const effectiveClaimType = allInstantOnly ? 'instant_claim' : claimType;

  const changeQty = (item, next) => {
    if (next < 0) return;
    const capped = Math.min(next, item.remaining);
    setQtyMap((s) => ({ ...s, [item.id]: capped }));
    setServerError(null);
  };

  /** Switch flow, clearing any quantity that the new flow would reject. */
  const changeClaim = (type) => {
    setClaimType(type);
    if (type === 'pickup_qc') {
      setQtyMap((s) => {
        const next = { ...s };
        for (const it of lines) {
          if (!canPickupReturn(it)) next[it.id] = 0;
        }
        return next;
      });
    }
    setServerError(null);
  };

  const submit = async () => {
    if (!hasSelected) return;
    const selected = lines
      .filter((it) => (qtyMap[it.id] || 0) > 0)
      .map((it) => ({ orderItemId: it.id, qty: qtyMap[it.id] }));

    const customReason = reasonCode === 'other' ? reasonText.trim() : '';
    if (reasonCode === 'other' && !customReason) {
      setServerError('Please tell us why you are returning it.');
      return;
    }

    setBusy(true);
    setServerError(null);
    try {
      const r = await api.shop.createReturn({
        orderId: order.id,
        items: selected,
        claimType: effectiveClaimType,
        reason: customReason || RETURN_REASONS.find((x) => x.code === reasonCode)?.label || reasonCode,
        reasonCode,
        customerNote: note.trim() || null,
      });
      if (!r.data?.eligible) {
        setServerError(r.data?.eligibility?.reason || 'This return is not eligible right now.');
        return;
      }
      toast(
        r.data.returnRequest?.claimType === 'instant_claim'
          ? 'Claim approved — refund initiated'
          : 'Return request approved — pickup scheduled',
        'success'
      );
      setQtyMap({});
      setNote('');
      setReasonText('');
      onCreated?.(r.data);
      onClose?.();
    } catch (e) {
      setServerError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const pickLine = (label, description, active, onSelect, disabled = false) => (
    <button
      key={label}
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex flex-1 flex-col items-start gap-1 rounded-xl border p-3 text-left transition',
        active ? 'border-transparent' : 'border-slate-200 hover:bg-slate-50',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-white'
      )}
      style={active ? { background: 'var(--brand-soft)', boxShadow: '0 0 0 2px var(--brand)' } : undefined}
    >
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <span className="text-xs leading-relaxed text-slate-500">{description}</span>
    </button>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Request a return"
      subtitle={order?.orderNumber ? `Order ${order.orderNumber}` : undefined}
      footer={
        <div className="space-y-3">
          {serverError && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{serverError}</p>
          )}
          <Button className="w-full" loading={busy} disabled={!hasSelected} onClick={submit}>
            {effectiveClaimType === 'instant_claim' ? 'Submit instant claim' : 'Request pickup'}
            {hasSelected && <span className="opacity-80">· {totalQty} item{totalQty === 1 ? '' : 's'}</span>}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            The store confirms eligibility and refund amount before refunding.
          </p>
        </div>
      }
    >
      {!lines.length ? (
        <Empty
          icon={RotateCcw}
          title="Nothing to return"
          message="All items in this order have already been returned."
          action={<Button variant="soft" onClick={onClose}>Close</Button>}
        />
      ) : (
        <div className="space-y-5">
          {/* 1. choose the flow */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Return type</p>
            <div className="flex gap-2">
              {pickLine(
                RETURN_CLAIM_META.pickup_qc.label,
                allInstantOnly ? 'This order has no returnable pickup items.' : RETURN_CLAIM_META.pickup_qc.description,
                !allInstantOnly && claimType === 'pickup_qc',
                () => changeClaim('pickup_qc'),
                allInstantOnly
              )}
              {pickLine(
                RETURN_CLAIM_META.instant_claim.label,
                RETURN_CLAIM_META.instant_claim.description,
                allInstantOnly || claimType === 'instant_claim',
                () => changeClaim('instant_claim')
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {effectiveClaimType === 'instant_claim'
                ? `Instant claims are for quality issues on fresh items, within ${INSTANT_CLAIM_WINDOW_HOURS} hours of delivery.`
                : `Standard returns are available within ${RETURN_WINDOW_DAYS} days of delivery.`}
            </p>
          </section>

          {/* 2. choose items + qty */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Items</p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {lines.map((it) => {
                const allowed = effectiveClaimType === 'instant_claim' || canPickupReturn(it);
                const qty = qtyMap[it.id] || 0;
                return (
                  <li key={it.id} className={cn('flex items-center gap-3 p-3', !allowed && 'opacity-40')}>
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-slate-50">
                      {it.skuSnapshot?.imageUrl ? (
                        <img src={it.skuSnapshot.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-xl" aria-hidden>🌸</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{it.skuSnapshot?.title}</p>
                      <p className="text-xs text-slate-500">
                        {!it.isReturnable && effectiveClaimType === 'pickup_qc'
                          ? 'Not eligible for pickup return'
                          : `${it.remaining} of ${it.qty} can be returned`}
                      </p>
                    </div>
                    {allowed ? (
                      <Stepper value={qty} min={0} max={it.remaining} onChange={(q) => changeQty(it, q)} />
                    ) : (
                      <span className="text-xs font-medium text-slate-400">Pickup return</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* 3. why */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reason</p>
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className="input" aria-label="Return reason">
              {RETURN_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            {reasonCode === 'other' && (
              <textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Tell us what went wrong (required)"
                className="input min-h-[80px] resize-y"
                maxLength={500}
              />
            )}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything else we should know? (optional)"
              className="input min-h-[72px] resize-y"
              maxLength={500}
            />
          </section>
        </div>
      )}
    </Sheet>
  );
}
