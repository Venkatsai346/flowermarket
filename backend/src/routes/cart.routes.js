import { Router } from 'express';
import CartController from '../controllers/cart.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
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
router.post('/items', validate(addCartItemSchema), CartController.addItem);
router.patch('/items/:id', validate(updateCartItemSchema), CartController.updateQty);
router.delete('/items/:id', CartController.removeItem);
router.delete('/', CartController.clear);
router.post('/revalidate', CartController.revalidate);
router.post('/quote', validate(checkoutQuoteSchema), CartController.quote);
router.post('/checkout', validate(checkoutSchema), CartController.checkout);

// coupons (Phase 3.5)
router.post('/coupon', validate(cartCouponSchema), CartController.applyCoupon);
router.delete('/coupon', CartController.removeCoupon);

// slotted delivery (customer)
router.get('/slots', CartController.listSlots);
router.post('/slots/:id/reserve', validate(slotReserveSchema, 'params'), CartController.reserveSlot);

export default router;
