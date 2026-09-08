import { useState } from 'react';
import { Banknote, PiggyBank, RefreshCw } from 'lucide-react';
import { fmtDateTime, inrPaise } from '@flower-market/shared';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { errMsg } from '../../lib/utils.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Stat from '../../components/ui/Stat.jsx';
import Table from '../../components/ui/Table.jsx';

/** Aging band → how worried to be. Cash owed since this morning is routine; cash owed since Tuesday is a phone call. */
const BAND_META = {
  lte_12h: { label: '< 12h', tone: 'emerald' },
  lte_24h: { label: '12–24h', tone: 'sky' },
  lte_48h: { label: '24–48h', tone: 'amber' },
  lte_72h: { label: '48–72h', tone: 'violet' },
  gt_72h: { label: '72h+', tone: 'rose' },
};

const BAND_ORDER = ['lte_12h', 'lte_24h', 'lte_48h', 'lte_72h', 'gt_72h'];

/**
 * Cash-on-delivery exposure.
 *
 * The one payment view in the console that is a RISK dashboard rather than a
 * ledger: cash is the only method where the platform extends credit to a
 * stranger and then sends an employee to collect it, so "how much is
 * outstanding, how old is it, and how much is sitting unbanked?" has no other
 * home. Everything here is read from the backend's exposure report — the UI
 * never derives money itself.
 *
 * Deliberately NO bulk "cancel stale cash orders" action. Unlike a stale
 * gateway payment, an uncollected COD order is a live delivery; the right
 * response is to chase the rider, not to cancel a customer's flowers.
 */
export default function CodExposurePanel({ refreshKey = 0, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const action = useAction();

  const { data, loading, refetch } = useApi(
    () => api.fulfillment.codOutstanding(),
    [refreshKey],
  );

  const r = data || {};
  const aging = r.aging || {};

  const act = async (id, fn, message) => {
    setBusyId(id);
    try {
      await action.run(fn);
      toast.success(message);
      refetch();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card
      title="Cash on delivery"
      subtitle="Uncollected cash is an unsecured loan to a customer and a theft risk on a bike. Aging matters more than the total."
      actions={<Button variant="secondary" icon={RefreshCw} onClick={refetch}>Refresh</Button>}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat
            label="Outstanding"
            value={r.outstandingCount || 0}
            sub={inrPaise(r.receivablePaise || 0)}
            tone={(r.outstandingCount || 0) > 0 ? 'amber' : 'emerald'}
          />
          <Stat
            label="Oldest owed"
            value={`${r.oldestAgeHours || 0}h`}
            sub={r.oldestAt ? fmtDateTime(r.oldestAt) : 'nothing outstanding'}
            tone={(r.oldestAgeHours || 0) > 48 ? 'rose' : (r.oldestAgeHours || 0) > 24 ? 'amber' : 'emerald'}
          />
          <Stat
            label="Collected, unbanked"
            value={r.collectedNotDeposited || 0}
            sub="notes in the field"
            tone={(r.collectedNotDeposited || 0) > 0 ? 'violet' : 'emerald'}
          />
          <Stat
            label="Overdue (72h+)"
            value={aging.gt_72h?.count || 0}
            sub={inrPaise(aging.gt_72h?.paise || 0)}
            tone={(aging.gt_72h?.count || 0) > 0 ? 'rose' : 'emerald'}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {BAND_ORDER.map((b) => {
            const band = aging[b];
            if (!band || !band.count) return null;
            const meta = BAND_META[b];
            return (
              <span
                key={b}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs"
              >
                <Badge tone={meta.tone}>{meta.label}</Badge>
                <span className="font-semibold text-slate-700">{band.count}</span>
                <span className="text-slate-500">{inrPaise(band.paise)}</span>
              </span>
            );
          })}
          {!(r.outstandingCount || 0) && (
            <span className="text-xs text-slate-400">No outstanding cash — every cash order has been collected.</span>
          )}
        </div>

        <Table
          loading={loading && !data}
          data={r.items || []}
          rowKey="paymentId"
          empty={<EmptyState icon={Banknote} title="No cash outstanding" message="Cash orders appear here until a rider collects them." />}
          columns={[
            { key: 'orderId', header: 'Order', render: (x) => <span className="font-mono text-xs text-slate-700">{x.orderId}</span> },
            { key: 'amountPaise', header: 'Owed', align: 'right', render: (x) => <span className="font-semibold">{inrPaise(x.amountPaise)}</span> },
            { key: 'ageHours', header: 'Age', align: 'right', render: (x) => `${x.ageHours}h` },
            { key: 'band', header: 'Band', render: (x) => <Badge tone={(BAND_META[x.band] || {}).tone || 'slate'}>{(BAND_META[x.band] || {}).label || x.band}</Badge> },
            { key: 'createdAt', header: 'Created', render: (x) => fmtDateTime(x.createdAt) },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (x) => (
                <Button
                  variant="secondary"
                  icon={PiggyBank}
                  size="sm"
                  loading={busyId === x.paymentId}
                  disabled={Boolean(busyId)}
                  onClick={() => act(x.paymentId, () => api.fulfillment.collectCodCash(x.paymentId), 'Cash collection recorded')}
                >
                  Record collection
                </Button>
              ),
            },
          ]}
        />
      </div>
    </Card>
  );
}
