import { useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock3, MapPin, PackageCheck, Phone, RotateCcw, Truck,
} from 'lucide-react';
import { fmtDateTime, fmtTime, pickMeta, relTime } from '@flower-market/shared';
import { cn } from '../../lib/utils.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import {
  RIDER_ASSIGNMENT_STATUS_META, RIDER_STEPS, stepIndex,
} from './riderMeta.js';

function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function acceptCountdown(expiresAt, now) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'accept window expired';
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `expires in ${secs}s`;
  return `expires in ${Math.ceil(secs / 60)}m`;
}

function StepStepper({ status }) {
  const current = stepIndex(status);
  if (current < 0) {
    return (
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <Badge tone={pickMeta(RIDER_ASSIGNMENT_STATUS_META, status).tone} dot>
          {pickMeta(RIDER_ASSIGNMENT_STATUS_META, status).label}
        </Badge>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {RIDER_STEPS.map((s, i) => {
        const done = i <= current;
        return (
          <div key={s.key} className="flex flex-1 flex-col items-center gap-1">
            <div className={cn('h-1.5 w-full rounded-full', done ? 'bg-emerald-500' : 'bg-slate-200')} />
            <span className={cn('text-[10px] font-medium', done ? 'text-slate-700' : 'text-slate-400')}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function DeliveryCard({ delivery, busy, onAction }) {
  const now = useNow(5000);
  const d = delivery;
  const id = d.id || d._id;
  const status = d.status;

  const doAction = (action, payload) => onAction?.({ delivery: d, action, payload });

  const buttons = <ActionRow d={d} busy={busy} onAction={doAction} />;

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 shrink-0 text-slate-400" />
            <p className="truncate font-mono text-xs font-semibold text-slate-700">Order {d.orderId}</p>
          </div>
          <p className="mt-1 font-mono text-[11px] text-slate-400">Assign {id}</p>
        </div>
        <Badge tone={pickMeta(RIDER_ASSIGNMENT_STATUS_META, status).tone} dot>
          {pickMeta(RIDER_ASSIGNMENT_STATUS_META, status).label}
        </Badge>
      </div>

      <StepStepper status={status} />

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-500">
        <p>Hub <span className="block font-medium text-slate-700">{d.hubId || 'Auto'}</span></p>
        <p>Assigned <span className="block font-medium text-slate-700">{relTime(d.assignedAt)}</span></p>
        <p>Package <span className="block font-medium text-slate-700">{d.packageVerified ? 'verified ✓' : 'not verified'}</span></p>
        <p>Rejects <span className="block font-medium text-slate-700">{d.rejectCount || 0}</span></p>
      </div>

      {status === 'pending_accept' && d.pendingAcceptExpiresAt && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          <Clock3 className="h-4 w-4 shrink-0" />
          <span>{acceptCountdown(d.pendingAcceptExpiresAt, now)}</span>
        </div>
      )}

      {d.needsManualAssignment && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Needs manual assignment by ops</span>
        </div>
      )}

      {status === 'delivered' && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{d.podType ? `Delivered · POD ${d.podType}` : 'Delivered'} · {fmtTime(d.completedAt)}</span>
        </div>
      )}

      {status === 'failed' && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{d.failureReason || 'Delivery failed'} · {relTime(d.failedAt)}</span>
        </div>
      )}

      <div className="mt-auto border-t border-slate-100 pt-3">{buttons}</div>
    </div>
  );
}

function ActionRow({ d, busy, onAction }) {
  const status = d.status;
  const id = d.id || d._id;

  if (status === 'pending_accept') {
    return (
      <div className="flex gap-2">
        <Button variant="success" icon={CheckCircle2} loading={busy} className="flex-1!" onClick={() => onAction('accept', { id, status })}>Accept</Button>
        <Button variant="danger" icon={RotateCcw} loading={busy} onClick={() => onAction('reject', { id, status })}>Reject</Button>
      </div>
    );
  }
  if (status === 'accepted') {
    return <Button variant="primary" icon={MapPin} loading={busy} className="w-full!" onClick={() => onAction('arrive_hub', { id, status })}>Arrive at hub</Button>;
  }
  if (status === 'at_hub') {
    return <Button variant="success" icon={PackageCheck} loading={busy} className="w-full!" onClick={() => onAction('depart', { id, status })}>Verify package & depart</Button>;
  }
  if (status === 'in_transit') {
    return <Button variant="primary" icon={Truck} loading={busy} className="w-full!" onClick={() => onAction('arrive', { id, status })}>Arrive at customer</Button>;
  }
  if (status === 'arrived') {
    return (
      <div className="flex gap-2">
        <Button variant="success" icon={CheckCircle2} loading={busy} className="flex-1!" onClick={() => onAction('complete', { id, status })}>Complete (POD)</Button>
        <Button variant="danger" icon={AlertTriangle} loading={busy} onClick={() => onAction('fail', { id, status })}>Fail</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      {status === 'delivered' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Clock3 className="h-4 w-4" />}
      {status === 'delivered' ? 'Delivery complete' : 'No rider action in this state'}
    </div>
  );
}
