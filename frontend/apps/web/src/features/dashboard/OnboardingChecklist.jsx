import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  MapPin,
  Rocket,
} from 'lucide-react';
import { api } from '../../api.js';
import { useAction, useApi } from '../../lib/useApi.js';
import { toast } from '../../lib/toasts.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import { cn } from '../../lib/utils.js';

/**
 * OnboardingChecklist — what stands between a registered store and a selling one.
 *
 * A self-registered store used to arrive with a Tenant, an owner login and a
 * trial subscription, and nothing else: no hub, no serviceable pincode, no open
 * slot, no fee policy. The storefront rendered and showed a catalogue, then
 * refused every checkout with "we don't deliver to this pincode" — correctly, but
 * the merchant was never told what to do about it, and `isPublished` could be
 * switched on the whole time.
 *
 * The server decides readiness (utils/onboardingReadiness.js) and refuses to
 * publish an unready store with 400 STORE_NOT_READY. This component is the other
 * half: it shows the gaps BEFORE the merchant tries, links each one to the page
 * that fixes it, and keeps the publish control honest about why it is disabled.
 *
 * Readiness is fetched rather than cached, because it goes stale the moment a
 * slot window passes or a hub is deactivated.
 */

/** Where each gap gets fixed. Ids are the API contract from ONBOARDING_ITEM. */
const FIX_ROUTE = {
  hub: { to: '/hubs', label: 'Add a hub' },
  pincodes: { to: '/hubs', label: 'Manage pincodes' },
  slots: { to: '/hubs', label: 'Open slots' },
  feePolicy: { to: '/policies', label: 'Set the fee' },
  products: { to: '/catalog', label: 'List products' },
  taxPolicies: { to: '/tax', label: 'Add tax policies' },
  profile: { to: '/storefront', label: 'Edit branding' },
  gstin: { to: '/tax', label: 'Add GSTIN' },
};

const STATE_TONE = { done: 'emerald', todo: 'rose', warn: 'amber' };

function ItemRow({ item }) {
  const fix = FIX_ROUTE[item.id];
  const Icon = item.state === 'done' ? CheckCircle2 : item.state === 'warn' ? AlertTriangle : Circle;

  return (
    <li className="flex items-start gap-3 px-5 py-3.5">
      <Icon
        className={cn(
          'mt-0.5 h-4.5 w-4.5 shrink-0',
          item.state === 'done' && 'text-emerald-600',
          item.state === 'warn' && 'text-amber-600',
          item.state === 'todo' && 'text-slate-300',
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              'text-sm font-medium',
              item.state === 'done' ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800',
            )}
          >
            {item.label}
          </p>
          {item.state !== 'done' && (
            <Badge tone={STATE_TONE[item.state]} dot>
              {item.blocking ? 'Required to sell' : 'Recommended'}
            </Badge>
          )}
          {item.count != null && item.count > 0 && (
            <span className="text-xs tabular-nums text-slate-400">{item.count}</span>
          )}
        </div>
        {item.state !== 'done' && (
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{item.hint}</p>
        )}
      </div>
      {item.state !== 'done' && fix && (
        <Link
          to={fix.to}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-800"
        >
          {fix.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}

export default function OnboardingChecklist({ onChanged } = {}) {
  const status = useApi(() => api.marketplace.myOnboarding(), []);
  const publish = useAction();

  if (status.loading && !status.data) return null;
  if (status.error && !status.data) return null;

  const s = status.data;
  if (!s) return null;

  const { items = [], ready, canPublish, blocking = [], warnings = [], progress = {}, isPublished } = s;
  const pct = progress.pct ?? 0;

  // A published, ready store has nothing to be told — do not occupy the top of
  // their dashboard with a green box they will learn to ignore.
  if (isPublished && ready) return null;

  const onPublish = async () => {
    try {
      await publish.run(() => api.marketplace.updateStore({ isPublished: true }));
      toast.success('Store published — it is live to customers.');
      await status.refetch();
      onChanged?.();
    } catch (e) {
      // STORE_NOT_READY carries the blocking list in details; the shared client
      // already toasted the server's sentence, which names every gap.
      await status.refetch();
    }
  };

  const onUnpublish = async () => {
    try {
      await publish.run(() => api.marketplace.updateStore({ isPublished: false }));
      toast.success('Store unpublished. Customers can no longer reach it.');
      await status.refetch();
      onChanged?.();
    } catch {
      /* the shared client surfaces the error */
    }
  };

  return (
    <Card
      className={cn(
        'overflow-hidden',
        ready ? 'border-emerald-200' : 'border-rose-200',
      )}
      bodyClassName="p-0"
      title={
        ready
          ? 'Your store is ready to sell'
          : `Get your store ready — ${blocking.length} thing${blocking.length === 1 ? '' : 's'} still block${blocking.length === 1 ? 's' : ''} checkout`
      }
      subtitle={
        ready
          ? 'Every requirement for taking an order is in place.'
          : 'Customers can browse right now, but checkout will refuse them until these exist.'
      }
      actions={
        isPublished ? (
          <Button variant="secondary" size="sm" loading={publish.busy} onClick={onUnpublish}>
            Unpublish
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon={Rocket}
            loading={publish.busy}
            disabled={!canPublish}
            onClick={onPublish}
            title={canPublish ? undefined : `Finish first: ${s.reasons?.join('; ') || 'see the list'}`}
          >
            Publish store
          </Button>
        )
      }
    >
      {/* progress */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn('h-full rounded-full transition-all', ready ? 'bg-emerald-500' : 'bg-rose-500')}
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Onboarding ${pct}% complete`}
          />
        </div>
        <span className="text-xs font-semibold tabular-nums text-slate-500">
          {progress.done ?? 0}/{progress.total ?? items.length}
        </span>
        {warnings.length > 0 && ready && (
          <Badge tone="amber">{warnings.length} recommended</Badge>
        )}
      </div>

      {!canPublish && !isPublished && (
        <p className="flex items-start gap-2 border-b border-slate-100 bg-rose-50/60 px-5 py-3 text-xs leading-relaxed text-rose-800">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Publishing is blocked until the required items are done. The server enforces
            this too — it will answer <code className="font-mono">STORE_NOT_READY</code> and
            list what is missing, so a store can never go live unable to take an order.
          </span>
        </p>
      )}

      <ul className="divide-y divide-slate-100">
        {items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
    </Card>
  );
}
