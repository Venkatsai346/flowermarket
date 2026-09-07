import { Router } from 'express';
import CartController from '../controllers/cart.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireActiveTenant } from '../middleware/requireActiveTenant.js';
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
 */
router.use(authenticate);

router.get('/', CartController.getCart);
router.post('/items', requireActiveTenant, validate(addCartItemSchema), CartController.addItem);
router.patch('/items/:id', requireActiveTenant, validate(updateCartItemSchema), CartController.updateQty);
router.delete('/items/:id', requireActiveTenant, CartController.removeItem);
router.delete('/', requireActiveTenant, CartController.clear);
router.delete('/clear', requireActiveTenant, CartController.clear);
router.post('/revalidate', requireActiveTenant, CartController.revalidate);
router.post('/quote', requireActiveTenant, validate(checkoutQuoteSchema), CartController.quote);
router.post('/checkout', requireActiveTenant, rateLimiters.checkoutLimiter, validate(checkoutSchema), CartController.checkout);

// coupons (Phase 3.5)
router.post('/coupon', requireActiveTenant, validate(cartCouponSchema), CartController.applyCoupon);
router.delete('/coupon', requireActiveTenant, CartController.removeCoupon);

// slotted delivery (customer)
router.get('/slots', CartController.listSlots);
router.post('/slots/:id/reserve', requireActiveTenant, validate(slotReserveSchema, 'params'), CartController.reserveSlot);

export default router;
