import returnsService from '../services/returns.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';

/**
 * ReturnsController — the two return flows (doc §6):
 *   A) PICKUP_QC  — pickup -> QC -> refund
 *   B) INSTANT_CLAIM — auto-approve + instant wallet refund (fraud-guarded)
 */
class ReturnsController {
  create = asyncHandler(async (req, res) => {
    const result = await returnsService.create({
      tenantId: req.tenantId, userId: req.auth.userId,
      orderId: req.body.orderId,
      items: req.body.items,
      reason: req.body.reason,
      reasonCode: req.body.reasonCode || null,
      claimType: req.body.claimType,
      customerNote: req.body.customerNote || null,
      actorId: req.auth.userId,
    });
    if (!result.eligible) {
      res.status(200).json(success(result.eligibility, { message: 'Return not eligible — see details' }));
      return;
    }
    res.status(201).json(created(result, {
      message: result.returnRequest.claimType === 'instant_claim'
        ? 'Instant claim approved — refund initiated'
        : 'Return request approved — pickup scheduled',
    }));
  });

  listMine = asyncHandler(async (req, res) => {
    const result = await returnsService.list({
      tenantId: req.tenantId, userId: req.auth.userId, query: req.query,
    });
    res.status(200).json(success(result.items, { message: 'Returns fetched', meta: result.meta }));
  });

  detail = asyncHandler(async (req, res) => {
    const result = await returnsService.detail({
      returnRequestId: req.params.id, tenantId: req.tenantId,
    });
    res.status(200).json(success(result, { message: 'Return request fetched' }));
  });

  markPickedUp = asyncHandler(async (req, res) => {
    const rr = await returnsService.markPickedUp({
      returnRequestId: req.params.id, tenantId: req.tenantId, actorId: req.auth.userId,
    });
    res.status(200).json(success(rr, { message: 'Return pickup confirmed' }));
  });

  qcDecision = asyncHandler(async (req, res) => {
    const rr = await returnsService.qcDecision({
      returnRequestId: req.params.id, tenantId: req.tenantId,
      decision: req.body.decision, note: req.body.note || null, actorId: req.auth.userId,
    });
    res.status(200).json(success(rr, {
      message: rr.status === 'refunded' ? 'QC passed — refund initiated' : 'QC decision recorded',
    }));
  });
}

export default new ReturnsController();
