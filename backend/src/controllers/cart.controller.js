import cartService from '../services/cart.service.js';
import orderService from '../services/order.service.js';
import slotService from '../services/slot.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';

/**
 * CartController — the disposable draft (doc §2).
 * Everything is tenant- + user-scoped; snapshots at add-time; the only trust
 * boundary is checkout revalidation.
 */
class CartController {
  getCart = asyncHandler(async (req, res) => {
    const result = await cartService.getCart({ tenantId: req.tenantId, userId: req.auth.userId });
    res.status(200).json(success(result, { message: 'Cart fetched' }));
  });

  addItem = asyncHandler(async (req, res) => {
    const result = await cartService.addItem({
      tenantId: req.tenantId, userId: req.auth.userId,
      tenantProductId: req.body.tenantProductId, qty: req.body.qty,
    });
    res.status(200).json(success(result, { message: 'Item added to cart' }));
  });

  updateQty = asyncHandler(async (req, res) => {
    const result = await cartService.updateQty({
      tenantId: req.tenantId, userId: req.auth.userId,
      itemId: req.params.id, qty: req.body.qty,
    });
    res.status(200).json(success(result, { message: 'Quantity updated' }));
  });

  removeItem = asyncHandler(async (req, res) => {
    const result = await cartService.removeItem({
      tenantId: req.tenantId, userId: req.auth.userId, itemId: req.params.id,
    });
    res.status(200).json(success(result, { message: 'Item removed from cart' }));
  });

  clear = asyncHandler(async (req, res) => {
    const result = await cartService.clear({ tenantId: req.tenantId, userId: req.auth.userId });
    res.status(200).json(success(result, { message: 'Cart cleared' }));
  });

  revalidate = asyncHandler(async (req, res) => {
    const result = await cartService.revalidate({ tenantId: req.tenantId, userId: req.auth.userId });
    res.status(200).json(success(result, {
      message: result.changed
        ? 'Prices or stock changed — review diffs and re-confirm'
        : 'Cart prices validated — safe to check out',
    }));
  });

  /** Exact checkout preflight for the held slot + address. Drives the
   *  storefront wallet gate: the client must not guess the final amount. With
   *  `confirmPriceChanges` it also snaps the cart to live prices, exactly like
   *  the checkout saga does. */
  quote = asyncHandler(async (req, res) => {
    const quote = await orderService.quote({
      tenantId: req.tenantId, userId: req.auth.userId,
      slotReservationId: req.body.slotReservationId,
      addressId: req.body.addressId,
      confirmPriceChanges: req.body.confirmPriceChanges === true,
    });
    res.status(200).json(success(quote, { message: 'Checkout quote fetched' }));
  });

  /** The saga entry: revalidate -> charge -> commit -> confirm slot -> queue picking. */
  checkout = asyncHandler(async (req, res) => {
    const order = await orderService.checkout({
      tenantId: req.tenantId, userId: req.auth.userId,
      slotReservationId: req.body.slotReservationId,
      addressId: req.body.addressId,
      paymentMethod: req.body.paymentMethod,
      idempotencyKey: req.body.idempotencyKey || null,
      confirmPriceChanges: req.body.confirmPriceChanges === true,
      source: req.body.source || 'app',
      req,
    });
    res.status(201).json(created(order, { message: 'Order placed — payment captured, picking queued' }));
  });

  // ---- coupons (Phase 3.5) ----
  applyCoupon = asyncHandler(async (req, res) => {
    const result = await cartService.applyCoupon({
      tenantId: req.tenantId, userId: req.auth.userId, code: req.body.code,
    });
    res.status(200).json(success(result, { message: 'Coupon applied' }));
  });

  removeCoupon = asyncHandler(async (req, res) => {
    const result = await cartService.removeCoupon({ tenantId: req.tenantId, userId: req.auth.userId });
    res.status(200).json(success(result, { message: 'Coupon removed' }));
  });

  // ---- slotted delivery browse + reserve (customer) ----
  listSlots = asyncHandler(async (req, res) => {
    const result = await slotService.listAvailable({
      tenantId: req.tenantId,
      pincode: req.query.pincode,
      date: req.query.date || null,
    });
    res.status(200).json(success(result, { message: 'Available delivery slots' }));
  });

  reserveSlot = asyncHandler(async (req, res) => {
    const hold = await slotService.reserve({
      tenantId: req.tenantId, userId: req.auth.userId, slotId: req.params.id,
    });
    res.status(200).json(success(hold, { message: 'Slot held for 10 minutes — complete checkout before expiry' }));
  });
}

export default new CartController();
