import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';
import { serializeList } from '../utils/serialize.js';

/**
 * PeriodController — fiscal period close (Phase 11).
 *
 * Platform routes (SUPER_ADMIN) live on /ledger/periods*; the tenant-scoped
 * read views live on /admin/periods* (ADMIN) — a store must see when its
 * books are closed and what posted in a period, but only super_admin
 * closes/reopens.
 */
class PeriodController {
  list = asyncHandler(async (req, res) => {
    const { default: periodService } = await import('../services/period.service.js');
    const items = await periodService.list({ tenantId: req.tenantId });
    res.json(success({ items: serializeList(items) }, { message: 'Fiscal periods' }));
  });

  report = asyncHandler(async (req, res) => {
    const { default: periodService } = await import('../services/period.service.js');
    const data = await periodService.periodReport({ tenantId: req.tenantId, periodKey: req.params.periodKey });
    res.json(success(data, { message: `Period report ${req.params.periodKey}` }));
  });

  close = asyncHandler(async (req, res) => {
    const { default: periodService } = await import('../services/period.service.js');
    const period = await periodService.closePeriod({
      tenantId: req.tenantId, periodKey: req.params.periodKey,
      req: { userId: req.user?._id, actorType: req.user?.role || 'user' },
    });
    res.json(success({ id: period._id, periodKey: period.periodKey, state: period.state, closedAt: period.closedAt }, { message: `Period ${period.periodKey} closed` }));
  });

  reopen = asyncHandler(async (req, res) => {
    const { default: periodService } = await import('../services/period.service.js');
    const period = await periodService.reopenPeriod({
      tenantId: req.tenantId, periodKey: req.params.periodKey,
      req: { userId: req.user?._id, actorType: req.user?.role || 'user' },
    });
    res.json(success({ id: period._id, periodKey: period.periodKey, state: period.state, reopenedAt: period.reopenedAt }, { message: `Period ${period.periodKey} reopened` }));
  });
}

export default new PeriodController();
