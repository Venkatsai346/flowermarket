/**
 * MaintenanceService — nightly ops pipeline (Phase 4b blueprint §5).
 *
 * Idempotent: every step is safe to re-run (forecast persists, analytics
 * upserts, export jobs are jobKey-unique, drain is at-least-once, worker is
 * stateless). Each step is isolated — a failure in one is recorded and does
 * not abort the others.
 */

import slotForecastingService from './slotForecasting.service.js';
import analyticsService from './analytics.service.js';
import exportService from './export.service.js';
import catalogEventService from './catalogEvent.service.js';
import notificationService from './notification.service.js';
import ledgerService from './ledger.service.js';
import ledgerPostingService from './ledgerPosting.service.js';
import taxDocumentService from './taxDocument.service.js';
import payoutService from './payout.service.js';
import searchIndexer from './searchIndexer.service.js';
import auditService from './audit.service.js';
import config from '../config/index.js';
import { EXPORT_JOB_TYPE } from '../constants/enums.js';

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

class MaintenanceService {
  /**
   * Run the nightly pipeline for a tenant.
   * @returns {object} per-step outcome (steps never throw to the caller).
   */
  async nightly({ tenantId, actorId = null, actorType = 'system', req = null, opts = {} }) {
    const out = {};
    const today = new Date();

    // 1. slot forecasting (persists capacities)
    try {
      out.forecast = await slotForecastingService.forecastUpcoming({ tenantId, days: opts.forecastDays || 7 });
    } catch (err) {
      out.forecast = { error: err?.message || String(err) };
    }

    // 2. analytics rollups (last N days)
    try {
      const from = dateStr(new Date(today.getTime() - (opts.analyticsDays || config.exports.nightlyDays) * 86400000));
      const to = dateStr(today);
      out.analytics = await analyticsService.rebuildDailyStats({ tenantId, from, to });
    } catch (err) {
      out.analytics = { error: err?.message || String(err) };
    }

    // 3. create analytics_daily export jobs (idempotent jobKey)
    try {
      const created = [];
      const days = opts.analyticsDays || config.exports.nightlyDays;
      for (let i = 0; i < days; i += 1) {
        const d = dateStr(new Date(today.getTime() - i * 86400000));
        const res = await exportService.createJob({
          tenantId,
          type: EXPORT_JOB_TYPE.ANALYTICS_DAILY,
          params: { from: d, to: d },
          requestedBy: actorId || null,
        });
        created.push({ date: d, created: res.created });
      }
      out.exportJobsCreated = created.filter((c) => c.created).length;
    } catch (err) {
      out.exportJobsCreated = { error: err?.message || String(err) };
    }

    // 4. run due export jobs
    try {
      out.exportsRun = await exportService.runDueJobs({ limit: opts.exportLimit || 20 });
    } catch (err) {
      out.exportsRun = { error: err?.message || String(err) };
    }

    // 5. drain catalog events → notification consumer fires
    try {
      out.eventsDrained = await catalogEventService.drain({ limit: opts.eventLimit || 50 });
    } catch (err) {
      out.eventsDrained = { error: err?.message || String(err) };
    }

    // 6. process pending notifications
    try {
      out.notificationsSent = await notificationService.processPending({ limit: opts.notificationLimit || config.notifications.workerBatch });
    } catch (err) {
      out.notificationsSent = { error: err?.message || String(err) };
    }

    // 7. Phase 6.1 — post any sale journal the saga could not write (crash,
    //    non-strict failure, or an order predating the ledger). Idempotent.
    try {
      out.ledgerBackfill = await ledgerPostingService.backfillSales({
        tenantId,
        limit: opts.ledgerBackfillLimit || 500,
      });
    } catch (err) {
      out.ledgerBackfill = { error: err?.message || String(err) };
    }

    // 8. Phase 6.2 — retry IRN registration for documents the IRP rejected or
    //    that were issued while the GSP was unreachable. A document is legally
    //    issued the moment it is numbered, so this is a follow-up, never a
    //    blocker.
    try {
      out.einvoiceRetries = await taxDocumentService.retryFailedEinvoices({
        limit: opts.einvoiceLimit || 50,
      });
    } catch (err) {
      out.einvoiceRetries = { error: err?.message || String(err) };
    }

    // 9. Phase 6.5 — search index freshness. The outbox is at-least-once, but
    //    a handler that threw during a drain leaves a stale document; this
    //    finds and repairs them rather than waiting for a customer to notice.
    try {
      out.searchIndex = await searchIndexer.freshnessCheck({ repair: true, limit: 200 });
    } catch (err) {
      out.searchIndex = { error: err?.message || String(err) };
    }

    await auditService.record({
      action: 'nightly', entityType: 'maintenance', entityId: tenantId || 'platform',
      tenantId, actorId: actorId || null, actorType,
      after: { steps: out }, req,
    }).catch(() => {});

    return out;
  }

  /**
   * Platform-wide marketplace pass (Phase 5) — run after the per-tenant nightly
   * from scripts/nightly-job.mjs or POST /marketplace/admin/nightly.
   * Every step isolated + idempotent: billing cycle per period, rollovers,
   * overdue sweep, platformdailies rollup, then the shared event drain +
   * notification worker (re-running never duplicates).
   */
  async marketplaceNightly({ actorId = null, actorType = 'system', req = null, opts = {} }) {
    const out = {};
    const today = new Date();

    // 1. billing cycle (invoice due periods, advance periods, rollovers)
    try {
      const billing = await (await import('./billing.service.js')).default.runBillingCycle({ actorId, req });
      out.billing = { scanned: billing.scanned, invoicesCreated: billing.invoicesCreated, periodsAdvanced: billing.periodsAdvanced };
    } catch (err) {
      out.billing = { error: err?.message || String(err) };
    }

    // 2. overdue sweep (open invoices past due+grace → overdue; subs → past_due)
    try {
      out.overdueSweep = await (await import('./billing.service.js')).default.overdueSweep({ req });
    } catch (err) {
      out.overdueSweep = { error: err?.message || String(err) };
    }

    // 3. platformdailies rollup (idempotent upsert)
    try {
      const days = opts.days || config.marketplace.nightlyDays;
      const from = dateStr(new Date(today.getTime() - days * 86400000));
      const to = dateStr(today);
      const analytics = await (await import('./marketplaceAnalytics.service.js')).default.rebuildPlatformDaily({ from, to, req, actorId });
      out.platformRollup = { rebuiltDays: analytics.rebuiltDays };
    } catch (err) {
      out.platformRollup = { error: err?.message || String(err) };
    }

    // 4. drain catalog events → notification consumer fires (shared, at-least-once)
    try {
      out.eventsDrained = await catalogEventService.drain({ limit: opts.eventLimit || 50 });
    } catch (err) {
      out.eventsDrained = { error: err?.message || String(err) };
    }

    // 5. process pending notifications
    try {
      out.notificationsSent = await notificationService.processPending({ limit: opts.notificationLimit || config.notifications.workerBatch });
    } catch (err) {
      out.notificationsSent = { error: err?.message || String(err) };
    }

    // 5b. Phase 6.3 — payout eligibility sweep. Promotes accrued lines to
    //     eligible once the return window has closed (and, when the policy
    //     requires it, once the PSP has actually settled the cash).
    try {
      out.payoutEligibility = await payoutService.markEligible({});
    } catch (err) {
      out.payoutEligibility = { error: err?.message || String(err) };
    }

    // 5c. Phase 6.3 — build payout batches for the cycle that just closed.
    //     Batches are created in DRAFT: a human still has to approve before
    //     any money moves. Idempotent on (vendor, cycle).
    try {
      if (opts.runPayoutCycle) {
        const to = new Date();
        const from = new Date(to.getTime() - (opts.payoutCycleDays || 7) * 86400000);
        out.payoutCycle = await payoutService.computeCycle({ from, to, actorId, req });
      } else {
        out.payoutCycle = { skipped: 'not a cycle day' };
      }
    } catch (err) {
      out.payoutCycle = { error: err?.message || String(err) };
    }

    // 5d. Phase 6.3/M5 — chase every batch stuck with the provider. This is
    //     the ONLY exit from an ambiguous submission; nothing here retries.
    try {
      out.payoutReconciliation = await payoutService.reconcileInFlight({});
    } catch (err) {
      out.payoutReconciliation = { error: err?.message || String(err) };
    }

    // 6. Phase 6.1 — LEDGER INTEGRITY. Two independent checks:
    //    a) trial balance: Σ debits === Σ credits across every entry. A failure
    //       means data was written outside ledgerService (post() makes an
    //       unbalanced journal impossible), i.e. tampering or a bad migration.
    //    b) drift: the materialized accountbalances vs a recompute from
    //       ledgerentries. On a standalone mongod this closes the crash window
    //       between the journal write and the balance $inc.
    //    Drift is REPAIRED (entries are the truth) and reported — a non-zero
    //    count is an ops alert, not a silent fix.
    try {
      const trial = await ledgerService.trialBalance();
      const verify = await ledgerService.verifyBalances({ repair: opts.repairLedger !== false });
      out.ledger = {
        balanced: trial.balanced,
        differencePaise: trial.differencePaise,
        accountsChecked: verify.checked,
        driftedAccounts: verify.drifted.length,
        repaired: verify.repaired,
        drift: verify.drifted.slice(0, 10),
      };
      if (!trial.balanced || verify.drifted.length) {
        // eslint-disable-next-line no-console
        console.error('[ledger] INTEGRITY ALERT', JSON.stringify(out.ledger));
      }
    } catch (err) {
      out.ledger = { error: err?.message || String(err) };
    }

    await auditService.record({
      action: 'marketplace_nightly', entityType: 'maintenance', entityId: 'platform',
      tenantId: null, actorId: actorId || null, actorType,
      after: { steps: out }, req,
    }).catch(() => {});

    return out;
  }
}

export default new MaintenanceService();
