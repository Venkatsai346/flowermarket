import cartService from '../services/cart.service.js';
import orderService from '../services/order.service.js';
import slotService from '../services/slot.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { unauthorized } from '../utils/ApiError.js';
import { clearGuestCookie, ensureGuestKey } from '../middleware/guestCart.js';

/**
 * CartController — the disposable draft (doc §2).
 *
 * Draft mutations (get/add/update/clear/coupon) accept a guest cookie.
 * Checkout, quote and slot reserve still require a signed-in user — identity
 * for payment, wallet and address book is not anonymous.
 */
class CartController {
  /** Resolve { tenantId, userId } or mint/keep a guest key. Merges on login. */
  async identity(req, res, { persistGuest = false } = {}) {
    const tenantId = req.tenantId;
    if (req.auth?.userId) {
      const guestKey = req.guestKey || null;
      if (guestKey) {
        await cartService.mergeGuestCart({ tenantId, userId: req.auth.userId, guestKey });
        clearGuestCookie(res);
        req.guestKey = null;
      }
      return { tenantId, userId: req.auth.userId };
    }
    const guestKey = persistGuest ? ensureGuestKey(req, res) : req.guestKey;
    return { tenantId, guestKey };
  }

  requireUser(req) {
    if (!req.auth?.userId) throw unauthorized('Sign in to continue', 'AUTH_REQUIRED');
    return { tenantId: req.tenantId, userId: req.auth.userId };
  }

  getCart = asyncHandler(async (req, res) => {
    const owner = await this.identity(req, res, { persistGuest: false });
    const result = await cartService.getCart(owner);
    res.status(200).json(success(result, { message: 'Cart fetched' }));
  });

  addItem = asyncHandler(async (req, res) => {
    const owner = await this.identity(req, res, { persistGuest: true });
    const result = await cartService.addItem({
      ...owner,
      tenantProductId: req.body.tenantProductId, qty: req.body.qty,
    });
    res.status(200).json(success(result, { message: 'Item added to cart' }));
  });

  updateQty = asyncHandler(async (req, res) => {
    const owner = await this.identity(req, res, { persistGuest: true });
    const result = await cartService.updateQty({
      ...owner,
      itemId: req.params.id, qty: req.body.qty,
    });
    res.status(200).json(success(result, { message: 'Quantity updated' }));
  });

  removeItem = asyncHandler(async (req, res) => {
    const owner = await this.identity(req, res, { persistGuest: true });
    const result = await cartService.removeItem({
      ...owner, itemId: req.params.id,
    });
    res.status(200).json(success(result, { message: 'Item removed from cart' }));
  });

  clear = asyncHandler(async (req, res) => {
    const owner = await this.identity(req, res, { persistGuest: true });
    const result = await cartService.clear(owner);
    res.status(200).json(success(result, { message: 'Cart cleared' }));
  });

  revalidate = asyncHandler(async (req, res) => {
    const owner = await this.identity(req, res, { persistGuest: false });
    const result = await cartService.revalidate(owner);
    res.status(200).json(success(result, {
      message: result.changed
        ? 'Prices or stock changed — review diffs and re-confirm'
        : 'Cart prices validated — safe to check out',
    }));
  });

  merge = asyncHandler(async (req, res) => {
    const { tenantId, userId } = this.requireUser(req);
    const result = await cartService.mergeGuestCart({
      tenantId, userId, guestKey: req.guestKey || null,
    });
    clearGuestCookie(res);
    res.status(200).json(success(result, { message: 'Guest cart merged' }));
  });

  /** Exact checkout preflight for the held slot + address. Drives the
   *  storefront wallet gate: the client must not guess the final amount. With
   *  `confirmPriceChanges` it also snaps the cart to live prices, exactly like
   *  the checkout saga does. */
  quote = asyncHandler(async (req, res) => {
    const { tenantId, userId } = this.requireUser(req);
    const quote = await orderService.quote({
      tenantId, userId,
      slotReservationId: req.body.slotReservationId,
      addressId: req.body.addressId,
      confirmPriceChanges: req.body.confirmPriceChanges === true,
    });
    res.status(200).json(success(quote, { message: 'Checkout quote fetched' }));
  });

  /** The saga entry: revalidate -> charge -> commit -> confirm slot -> queue picking. */
  checkout = asyncHandler(async (req, res) => {
    const { tenantId, userId } = this.requireUser(req);
    const order = await orderService.checkout({
      tenantId, userId,
      slotReservationId: req.body.slotReservationId,
      addressId: req.body.addressId,
      paymentMethod: req.body.paymentMethod,
      idempotencyKey: req.body.idempotencyKey || null,
      confirmPriceChanges: req.body.confirmPriceChanges === true,
      source: req.body.source || 'app',
      gift: req.body.gift,
      req,
    });
    res.status(201).json(created(order, { message: 'Order placed — payment captured, picking queued' }));
  });

  // ---- coupons (Phase 3.5) ----
  setGift = asyncHandler(async (req, res) => {
    const owner = await this.identity(req, res, { persistGuest: true });
    const result = await cartService.setGift({ ...owner, gift: req.body });
    res.status(200).json(success(result, { message: 'Gift details saved' }));
  });

  reorder = asyncHandler(async (req, res) => {
    const { tenantId, userId } = this.requireUser(req);
    const result = await cartService.reorderFromOrder({
      tenantId, userId, orderId: req.body.orderId,
    });
    const skipped = result.skipped?.length || 0;
    res.status(200).json(success(result, {
      message: skipped
        ? `${skipped} item${skipped === 1 ? '' : 's'} no longer available — the rest is in your basket`
        : 'Order copied to your basket',
    }));
  });

  applyCoupon = asyncHandler(async (req, res) => {
    const owner = await this.identity(req, res, { persistGuest: true });
    const result = await cartService.applyCoupon({
      ...owner, code: req.body.code,
    });
    res.status(200).json(success(result, { message: 'Coupon applied' }));
  });

  removeCoupon = asyncHandler(async (req, res) => {
    const owner = await this.identity(req, res, { persistGuest: true });
    const result = await cartService.removeCoupon(owner);
    res.status(200).json(success(result, { message: 'Coupon removed' }));
  });

  // ---- slotted delivery browse + reserve (customer) ----
  listSlots = asyncHandler(async (req, res) => {
    const result = await slotService.listAvailable({
      tenantId: req.tenantId,
      pincode: req.query.pincode,
      date: req.query.date || null,
      fromDate: req.query.fromDate || null,
      toDate: req.query.toDate || null,
      days: req.query.days ? Number(req.query.days) : null,
    });
    res.status(200).json(success(result, { message: 'Available delivery slots' }));
  });

  reserveSlot = asyncHandler(async (req, res) => {
    const { tenantId, userId } = this.requireUser(req);
    const hold = await slotService.reserve({
      tenantId, userId, slotId: req.params.id,
    });
    res.status(200).json(success(hold, { message: 'Slot held for 10 minutes — complete checkout before expiry' }));
  });
}

export default new CartController();
