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

    await auditService.record({
      action: 'marketplace_nightly', entityType: 'maintenance', entityId: 'platform',
      tenantId: null, actorId: actorId || null, actorType,
      after: { steps: out }, req,
    }).catch(() => {});

    return out;
  }
}

export default new MaintenanceService();
