import { Router } from 'express';
import CartController from '../controllers/cart.controller.js';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { guestCart } from '../middleware/guestCart.js';
import { requireActiveTenant } from '../middleware/requireActiveTenant.js';
import { requireBillingCurrent } from '../middleware/requireBillingCurrent.js';
import { validate } from '../middleware/validate.js';
import rateLimiters from '../middleware/rateLimiter.js';
import {
  addCartItemSchema,
  updateCartItemSchema,
  checkoutQuoteSchema,
  checkoutSchema,
  slotReserveSchema,
  cartCouponSchema,
} from '../utils/validators/order.validators.js';

const router = Router();

/**
 * /cart — customer cart (disposable draft) + checkout saga + slot browse.
 *
 * Draft mutations are guest-capable (cookie / x-guest-key). Quote, checkout
 * and slot reserve still require a Bearer token — checkout identity stays OTP.
 */
router.use(optionalAuthenticate);
router.use(guestCart);

router.get('/', CartController.getCart);
router.post('/items', requireActiveTenant, validate(addCartItemSchema), CartController.addItem);
router.patch('/items/:id', requireActiveTenant, validate(updateCartItemSchema), CartController.updateQty);
router.delete('/items/:id', requireActiveTenant, CartController.removeItem);
router.delete('/', requireActiveTenant, CartController.clear);
router.delete('/clear', requireActiveTenant, CartController.clear);
router.post('/revalidate', requireActiveTenant, CartController.revalidate);
router.post('/merge', authenticate, CartController.merge);
router.post('/quote', authenticate, requireActiveTenant, validate(checkoutQuoteSchema), CartController.quote);
router.post('/checkout', authenticate, requireActiveTenant, requireBillingCurrent, rateLimiters.checkoutLimiter, validate(checkoutSchema), CartController.checkout);

// coupons (Phase 3.5)
router.post('/coupon', requireActiveTenant, validate(cartCouponSchema), CartController.applyCoupon);
router.delete('/coupon', requireActiveTenant, CartController.removeCoupon);

// slotted delivery (customer) — browse is public-to-the-store; hold is signed-in
router.get('/slots', CartController.listSlots);
router.post('/slots/:id/reserve', authenticate, requireActiveTenant, validate(slotReserveSchema, 'params'), CartController.reserveSlot);

export default router;
