import orderService from '../services/order.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';

/**
 * OrderController — customer-facing order reads + cancellation.
 * Fulfillment actions (pick/pack/dispatch/POD) live in ops.controller.js.
 */
class OrderController {
  detail = asyncHandler(async (req, res) => {
    const result = await orderService.detail({
      tenantId: req.tenantId, orderId: req.params.id, userId: req.auth.userId,
    });
    res.status(200).json(success(result, { message: 'Order fetched' }));
  });

  timeline = asyncHandler(async (req, res) => {
    const result = await orderService.timeline({
      tenantId: req.tenantId, orderId: req.params.id, userId: req.auth.userId,
    });
    res.status(200).json(success(result, { message: 'Order timeline fetched' }));
  });

  listMine = asyncHandler(async (req, res) => {
    const result = await orderService.listMine({
      tenantId: req.tenantId, userId: req.auth.userId, query: req.query,
    });
    res.status(200).json(success(result.items, { message: 'Orders fetched', meta: result.meta }));
  });

  cancel = asyncHandler(async (req, res) => {
    const result = await orderService.cancelOrder({
      tenantId: req.tenantId, orderId: req.params.id,
      reason: req.body.reason, reasonText: req.body.reasonText || null,
      actorId: req.auth.userId, actorType: 'customer', refund: true, req,
    });
    res.status(200).json(success(result, { message: 'Order cancelled — refund initiated (if paid)' }));
  });
}

export default new OrderController();
