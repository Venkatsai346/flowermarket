/**
 * Built-in scheduled jobs for the worker runtime.
 *
 * Jobs are CODE-DEFINED (this file) with PERSISTED STATE (ScheduledJob rows):
 *  - seed(): upserts the built-in set on worker boot (no migration needed).
 *  - tick(): claims and runs any job whose nextRunAt has come due.
 *
 * Two cadences:
 *  - daily:  { hour, minute }   (nightly pipelines)
 *  - interval: { everyMs }      (frequent sweeps, e.g. payment reconciliation)
 *
 * SINGLE-FLIGHT across N workers / restarts: a run is claimed by atomically
 * advancing `nextRunAt` with the expected current value
 * (findOneAndUpdate); only the claim-winner executes. If a worker dies
 * mid-run the run is lost but the schedule has advanced — acceptable because
 * every built-in job is idempotent (the next cycle covers it; the per-step
 * isolation inside maintenanceService already swallows partial failures).
 */

import Tenant from '../models/tenant.model.js';
import ScheduledJob from '../models/scheduledJob.model.js';
import config from '../config/index.js';

/** Next local wall-clock time at `hour:minute` strictly after `from`. */
function nextDailyRun(from, hour, minute) {
  const t = new Date(from);
  t.setHours(hour, minute, 0, 0);
  if (t.getTime() <= from.getTime()) t.setDate(t.getDate() + 1);
  return t;
}

/** Next run time for a def (interval or daily), strictly after `from`. */
function nextRunAt(def, from) {
  if (def.everyMs) return new Date(from.getTime() + def.everyMs);
  return nextDailyRun(from, def.hour, def.minute);
}

function scheduleLabel(def) {
  return def.everyMs ? `every ${Math.round(def.everyMs / 60000)}m` : `daily @ ${String(def.hour).padStart(2, '0')}:${String(def.minute).padStart(2, '0')}`;
}

/**
 * Built-in job definitions. `run` must be idempotent; throwing records
 * lastStatus=error on the job row (the scheduler never crashes on a job).
 */
export function builtinJobs() {
  const hour = config.worker.nightlyHour;
  return [
    {
      name: 'tenant-nightly',
      schedule: `daily @ ${String(hour).padStart(2, '0')}:00 (per active tenant)`,
      minute: 0,
      hour,
      async run() {
        const { default: maintenanceService } = await import('../services/maintenance.service.js');
        const tenants = await Tenant.find({ status: 'active' }).select('_id name').lean();
        const perTenant = [];
        for (const t of tenants) {
          // nightly() isolates each step internally — one tenant's error
          // never aborts the others
          const out = await maintenanceService.nightly({ tenantId: t._id });
          perTenant.push({ tenantId: String(t._id), ...out });
        }
        return { tenants: perTenant.length, perTenant };
      },
    },
    {
      // runs after the tenant pass (billing cycle needs the fresh rollups)
      name: 'marketplace-nightly',
      schedule: `daily @ ${String(hour).padStart(2, '0')}:05 (platform-wide)`,
      minute: 5,
      hour,
      async run() {
        const { default: maintenanceService } = await import('../services/maintenance.service.js');
        return await maintenanceService.marketplaceNightly({});
      },
    },
    {
      // Frequent sweep that closes the async-payment loop:
      //   1. stale PENDING payments -> ask the GATEWAY for authoritative
      //      state (webhook-loss recovery) -> confirm or fail + cancel order
      //   2. in-flight gateway refunds -> confirm from the gateway
      name: 'payment-reconcile',
      schedule: `every ${Math.round(config.payments.reconcileEveryMs / 60000)}m (stale > ${config.payments.pendingStaleMinutes}m)`,
      everyMs: config.payments.reconcileEveryMs,
      async run() {
        const { default: paymentService } = await import('../services/payment.service.js');
        const { default: refundService } = await import('../services/refund.service.js');
        const { paymentReconcile } = await import('../observability/registry.js');
        try {
          const payments = await paymentService.reconcilePending({
            olderThanMinutes: config.payments.pendingStaleMinutes,
            limit: 50,
          });
          const refunds = await refundService.reconcileRefunds({ olderThanMinutes: 10, limit: 50 });
          paymentReconcile.inc({ result: 'ok' });
          return {
            paymentsScanned: payments.scanned,
            paymentsFailed: payments.failed.length,
            paymentsCancelled: payments.cancelled.length,
            refundsScanned: refunds.scanned,
            refundsResolved: refunds.resolved.length,
          };
        } catch (err) {
          paymentReconcile.inc({ result: 'error' });
          throw err;
        }
      },
    },
    {
      // Expire HELD slot reservations and give capacity back. Must never be
      // a Mongo TTL — TTL deletes the row without decrementing reservedCapacity.
      name: 'slot-hold-sweep',
      schedule: 'every 1m (expire held slots, restore capacity)',
      everyMs: 60 * 1000,
      async run() {
        const { default: slotService } = await import('../services/slot.service.js');
        return slotService.sweepExpiredHolds({ limit: 200 });
      },
    },
    {
      // PENDING_ACCEPT past the 45s window → free the rider and offer the
      // next candidate. Without this, a missed accept leaves the rider BUSY
      // forever and new dispatches cannot be assigned.
      name: 'assignment-accept-sweep',
      schedule: 'every 15s (expire rider accept window, reassign)',
      everyMs: 15 * 1000,
      async run() {
        const { default: fulfillmentService } = await import('../services/fulfillment.service.js');
        return fulfillmentService.sweepExpiredAssignments({ limit: 100 });
      },
    },
    {
      // Release inventory reserved by carts idle for ~2h so stock is not
      // locked until the 30-day cart TTL.
      name: 'cart-reservation-sweep',
      schedule: 'every 5m (release idle cart stock holds)',
      everyMs: 5 * 60 * 1000,
      async run() {
        const { default: cartService } = await import('../services/cart.service.js');
        return cartService.sweepAbandonedReservations({ limit: 200 });
      },
    },
  ];
}

/** Upsert the built-in set; returns the job rows. */
export async function seedJobs(defs = builtinJobs()) {
  const rows = [];
  for (const def of defs) {
    const existing = await ScheduledJob.findOne({ name: def.name });
    if (existing) {
      // keep schedule metadata fresh if code changed it
      if (existing.schedule !== def.schedule) {
        existing.schedule = def.schedule;
        await existing.save();
      }
      rows.push(existing);
      continue;
    }
    rows.push(
      await ScheduledJob.create({
        name: def.name,
        schedule: scheduleLabel(def),
        nextRunAt: nextRunAt(def, new Date()),
      }),
    );
  }
  return rows;
}

/**
 * Claim + run every due job. Claim is atomic (single-flight). Runs are
 * fire-and-forget so a long nightly pass never starves the outbox poll.
 * @returns {Promise<string[]>} names claimed (started) this tick
 */
export async function tick(workerId, defs = builtinJobs()) {
  const now = new Date();
  const due = await ScheduledJob.find({ nextRunAt: { $lte: now } }).select('_id name nextRunAt').lean();
  const started = [];
  for (const j of due) {
    const def = defs.find((d) => d.name === j.name);
    if (!def) continue; // unknown job (removed from code) — leave the row dormant
    const next = nextRunAt(def, now);
    const claimed = await ScheduledJob.findOneAndUpdate(
      { _id: j._id, nextRunAt: j.nextRunAt }, // expected-value guard ⇒ single-flight
      { $set: { nextRunAt: next, lastRunner: workerId } },
    );
    if (!claimed) continue; // another worker claimed it
    started.push(j.name);
    // record the outcome when the (possibly long) run finishes
    void Promise.resolve()
      .then(def.run)
      .then((result) =>
        ScheduledJob.updateOne({ name: j.name }, {
          $set: { lastRunAt: new Date(), lastStatus: 'ok', lastResult: result ?? null },
        }).catch(() => {}),
      )
      .catch((err) =>
        ScheduledJob.updateOne({ name: j.name }, {
          $set: { lastRunAt: new Date(), lastStatus: 'error', lastResult: { error: err?.message || String(err) } },
        }).catch(() => {}),
      );
  }
  return started;
}
