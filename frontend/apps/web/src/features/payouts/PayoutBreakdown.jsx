import { inr, signedInr, fmtDate } from '@flower-market/shared';
import { cn } from '../../lib/utils.js';
import Badge from '../../components/ui/Badge.jsx';
import { LINE_STATE_META } from './payoutMeta.js';

/**
 * PayoutWaterfall — the deduction breakdown, shown the way a vendor argues
 * about it: start from what the customer paid, subtract each item, arrive at
 * the transfer. Every number is server-computed; this component never does
 * arithmetic beyond rendering, so the UI can never disagree with the ledger.
 */
export function PayoutWaterfall({ rupees, className }) {
  if (!rupees) return null;
  const rows = [
    { label: 'Gross sales', value: rupees.gross, kind: 'base', hint: 'What customers paid for your items' },
    { label: 'Platform commission', value: -Math.abs(rupees.commission || 0), kind: 'deduct' },
    { label: 'GST on commission', value: -Math.abs(rupees.gstOnCommission || 0), kind: 'deduct', hint: '18% on our service fee' },
    { label: 'TCS collected (GST s.52)', value: -Math.abs(rupees.tcs || 0), kind: 'deduct', hint: 'Deposited by the platform on your behalf' },
    { label: 'TDS deducted (s.194-O)', value: -Math.abs(rupees.tds || 0), kind: 'deduct' },
  ];
  if (rupees.adjustments) rows.push({ label: 'Adjustments', value: rupees.adjustments, kind: 'adjust' });
  if (rupees.openingBalance) rows.push({ label: 'Brought forward', value: rupees.openingBalance, kind: 'adjust' });

  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200', className)}>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.label} className={r.kind === 'base' ? 'bg-slate-50/60' : undefined}>
              <td className="px-4 py-2.5 text-slate-700">
                {r.label}
                {r.hint && <span className="block text-[11px] text-slate-400">{r.hint}</span>}
              </td>
              <td
                className={cn(
                  'px-4 py-2.5 text-right font-medium tabular-nums',
                  r.kind === 'base' && 'text-slate-900',
                  r.kind === 'deduct' && 'text-rose-600',
                  r.kind === 'adjust' && (r.value < 0 ? 'text-rose-600' : 'text-emerald-600')
                )}
              >
                {r.kind === 'base' ? inr(r.value) : signedInr(r.value)}
              </td>
            </tr>
          ))}
          <tr className="bg-emerald-50/60">
            <td className="px-4 py-3 text-base font-semibold text-slate-900">Net transferred</td>
            <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-emerald-700">{inr(rupees.net)}</td>
          </tr>
          {Boolean(rupees.carryForward) && (
            <tr>
              <td className="px-4 py-2.5 text-slate-500">
                Carried to next cycle
                <span className="block text-[11px] text-slate-400">
                  {rupees.carryForward < 0
                    ? 'Negative balance — offset against future sales'
                    : 'Below the payout floor — rolls forward'}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right font-medium tabular-nums text-amber-600">{signedInr(rupees.carryForward)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Per-order line detail — the answer to "which sale is this?". */
export function PayoutLines({ lines = [] }) {
  if (!lines.length) return <p className="px-1 py-3 text-sm text-slate-400">No lines in this batch.</p>;
  return (
    <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Order</th>
            <th className="px-3 py-2 text-right font-semibold">Gross</th>
            <th className="px-3 py-2 text-right font-semibold">Commission</th>
            <th className="px-3 py-2 text-right font-semibold">TCS + TDS</th>
            <th className="px-3 py-2 text-right font-semibold">Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l, i) => (
            <tr key={`${l.orderNumber}-${i}`} className={l.isReversal ? 'bg-rose-50/40' : undefined}>
              <td className="px-3 py-2 font-mono text-xs text-slate-600">
                {l.orderNumber}
                {l.isReversal && <Badge tone="rose" className="ml-2">refund</Badge>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{signedInr(l.gross)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                {signedInr(-Math.abs(l.commission))}
                <span className="ml-1 text-[10px] text-slate-400">{l.commissionRatePct}%</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                {signedInr(-(Math.abs(l.tcs) + Math.abs(l.tds)))}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{signedInr(l.netPayable)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Batch header facts: cycle, destination, rail, UTR. */
export function PayoutFacts({ batch }) {
  const acct = batch.payoutAccount || {};
  const facts = [
    ['Cycle', batch.cycle?.label || `${fmtDate(batch.cycle?.from)} → ${fmtDate(batch.cycle?.to)}`],
    ['Destination', acct.maskedAccount || acct.vpa || '—'],
    ['Rail', batch.transferMode || '—'],
    ['Provider', batch.provider || '—'],
    ['UTR', batch.utr || '—'],
    ['Submitted', batch.submittedAt ? fmtDate(batch.submittedAt) : '—'],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
      {facts.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
          <dd className="truncate font-medium text-slate-700">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LineStateBadge({ state }) {
  const m = LINE_STATE_META[state] || { label: state, tone: 'slate' };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
