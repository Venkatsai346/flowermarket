import Cart from '../models/cart.model.js';
import CartItem from '../models/cartItem.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import inventoryService from './inventory.service.js';
import pricingPolicyService from './pricingPolicy.service.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';
import { roundMoney, moneySum } from '../utils/money.js';
import {
  CART_STATUS,
  CART_ITEM_LIMIT,
  TENANT_LISTING_STATUS,
  PRODUCT_MASTER_STATUS,
} from '../constants/enums.js';

/**
 * CartService — the disposable draft (doc §2).
 *
 * - Snapshot price/stock at add/update time; NEVER trusted at checkout.
 * - revalidate() refetches live price + available stock for every line and
 *   returns the diff; checkout refuses to proceed until the customer
 *   explicitly confirms price changes (stale-cart problem solved).
 * - Item limit (50) keeps carts bounded.
 */
class CartService {
  /** Get the active cart for a user, creating it lazily. */
  async getOrCreateActive({ tenantId, userId }) {
    let cart = await Cart.findOne({ tenantId, userId, status: CART_STATUS.ACTIVE });
    if (!cart) {
      cart = await Cart.create({ tenantId, userId, status: CART_STATUS.ACTIVE });
    }
    return cart;
  }

  async getCart({ tenantId, userId }) {
    const cart = await this.getOrCreateActive({ tenantId, userId });
    const items = await CartItem.find({ cartId: cart._id }).sort({ createdAt: 1 }).lean();
    return { cart, items: serializeList(items) };
  }

  /** Add or increment an item; snapshots price/stock from the live listing. */
  async addItem({ tenantId, userId, tenantProductId, qty }) {
    const q = Math.max(1, Math.floor(Number(qty) || 1));
    const cart = await this.getOrCreateActive({ tenantId, userId });

    const existing = await CartItem.findOne({ cartId: cart._id, tenantProductId });
    const distinctCount = existing ? await CartItem.countDocuments({ cartId: cart._id }) : await CartItem.countDocuments({ cartId: cart._id }) + 1;
    if (distinctCount > CART_ITEM_LIMIT) {
      throw badRequest(`Cart supports up to ${CART_ITEM_LIMIT} distinct items`, 'CART_ITEM_LIMIT');
    }

    const listing = await TenantProduct.findOne({
      _id: tenantProductId, tenantId, status: TENANT_LISTING_STATUS.ACTIVE,
    });
    if (!listing) throw notFound('Product listing not found or inactive', 'LISTING_NOT_AVAILABLE');

    const master = await ProductMaster.findById(listing.productMasterId).lean();
    if (!master || master.status !== PRODUCT_MASTER_STATUS.ACTIVE) {
      throw badRequest('Product master is not active', 'MASTER_NOT_AVAILABLE');
    }

    const stock = await inventoryService.getStock({ tenantId, listingId: listing._id });
    const available = stock.qtyAvailable ?? 0;
    const nextQty = existing ? existing.qty + q : q;

    if (nextQty > available) {
      throw conflict(`Only ${available} available`, 'INSUFFICIENT_STOCK', { available });
    }

    const snapshot = {
      mrp: listing.price?.mrp ?? null,
      sellingPrice: listing.price?.sellingPrice ?? 0,
      currency: listing.price?.currency || 'INR',
    };
    const lineTotal = roundMoney(snapshot.sellingPrice * nextQty);

    let item;
    if (existing) {
      existing.qty = nextQty;
      existing.lineTotal = lineTotal;
      existing.updatedAt = new Date();
      item = await existing.save();
    } else {
      item = await CartItem.create({
        cartId: cart._id,
        tenantId,
        tenantProductId: listing._id,
        productMasterId: master._id,
        variantId: listing.variantId || null,
        qty: nextQty,
        priceSnapshot: snapshot,
        stockSnapshot: { availableQty: available, checkedAt: new Date() },
        titleSnapshot: master.title,
        imageUrlSnapshot: null,
        unitSnapshot: master.defaultSellingUnit || null,
        lineTotal,
        isReturnable: !(master.isPerishable === true && master.type !== 'flower_bouquet' && master.type !== 'plant'),
      });
    }

    await this.refreshTotals(cart);
    return this.getCart({ tenantId, userId });
  }

  async updateQty({ tenantId, userId, itemId, qty }) {
    const cart = await this.getOrCreateActive({ tenantId, userId });
    const item = await CartItem.findOne({ _id: itemId, cartId: cart._id });
    if (!item) throw notFound('Cart item not found', 'CART_ITEM_NOT_FOUND');
    if (qty <= 0) return this.removeItem({ tenantId, userId, itemId });

    const listing = await TenantProduct.findOne({ _id: item.tenantProductId, tenantId });
    const stock = listing ? await inventoryService.getStock({ tenantId, listingId: listing._id }) : { qtyAvailable: 0 };
    const available = stock.qtyAvailable ?? 0;
    if (qty > available) throw conflict(`Only ${available} available`, 'INSUFFICIENT_STOCK', { available });

    item.qty = Math.floor(qty);
    item.lineTotal = roundMoney((item.priceSnapshot?.sellingPrice || 0) * item.qty);
    item.updatedAt = new Date();
    await item.save();
    await this.refreshTotals(cart);
    return this.getCart({ tenantId, userId });
  }

  async removeItem({ tenantId, userId, itemId }) {
    const cart = await this.getOrCreateActive({ tenantId, userId });
    await CartItem.deleteOne({ _id: itemId, cartId: cart._id });
    await this.refreshTotals(cart);
    return this.getCart({ tenantId, userId });
  }

  async clear({ tenantId, userId }) {
    const cart = await this.getOrCreateActive({ tenantId, userId });
    await CartItem.deleteMany({ cartId: cart._id });
    await this.refreshTotals(cart);
    return this.getCart({ tenantId, userId });
  }

  /**
   * Checkout revalidation — refetch live price + stock per line and return the
   * diff. If any price changed, checkout must NOT proceed until the client
   * re-confirms (passes confirmPriceChanges=true).
   * @returns { changed: boolean, diffs: Array, total: number }
   */
  async revalidate({ tenantId, userId }) {
    const { cart, items } = await this.getCart({ tenantId, userId });
    const diffs = [];
    let changed = false;
    let total = 0;

    for (const item of items) {
      const listing = await TenantProduct.findOne({ _id: item.tenantProductId, tenantId }).lean();
      if (!listing || listing.status !== TENANT_LISTING_STATUS.ACTIVE) {
        changed = true;
        diffs.push({ itemId: item.id, listingId: item.tenantProductId, issue: 'unavailable' });
        continue;
      }
      const livePrice = listing.price?.sellingPrice ?? 0;
      const snapshotPrice = item.priceSnapshot?.sellingPrice ?? 0;
      if (livePrice !== snapshotPrice) {
        changed = true;
        diffs.push({
          itemId: item.id, listingId: item.tenantProductId,
          issue: 'price_changed',
          from: snapshotPrice, to: livePrice,
        });
      }
      const stock = await inventoryService.getStock({ tenantId, listingId: listing._id });
      if (item.qty > (stock.qtyAvailable ?? 0)) {
        changed = true;
        diffs.push({
          itemId: item.id, listingId: item.tenantProductId,
          issue: 'qty_capped',
          requested: item.qty, available: stock.qtyAvailable,
        });
      }
      total = moneySum(total, livePrice * item.qty);
    }

    return { changed, diffs, total, itemCount: items.length };
  }

  /** Apply a coupon to the cart (validated against live subtotal). */
  async applyCoupon({ tenantId, userId, code }) {
    const { cart } = await this.getCart({ tenantId, userId });
    const { coupon, discountAmount } = await pricingPolicyService.applyCoupon({
      tenantId, code, userId, cartSubtotal: cart.subtotal,
    });
    cart.couponCode = coupon.code;
    cart.couponId = coupon._id;
    await cart.save();
    return { cart, coupon: { id: coupon._id, code: coupon.code, discountType: coupon.discountType, value: coupon.value, discountAmount } };
  }

  /** Remove the coupon from the cart. */
  async removeCoupon({ tenantId, userId }) {
    const { cart } = await this.getCart({ tenantId, userId });
    cart.couponCode = null;
    cart.couponId = null;
    await cart.save();
    return { cart };
  }

  /**
   * Apply LIVE prices/stock to cart items (called by checkout AFTER the
   * customer re-confirms a price change). The cart is a disposable draft, so
   * once the customer confirms the new numbers we snap the items to reality:
   *   - priceSnapshot/lineTotal <- live selling price
   *   - qty capped at available stock; zero-stock lines dropped
   * @returns { refreshed, dropped: [{listingId, title}] }
   */
  async applyLivePrices({ tenantId, userId }) {
    const { cart, items } = await this.getCart({ tenantId, userId });
    const dropped = [];
    for (const item of items) {
      const listing = await TenantProduct.findOne({ _id: item.tenantProductId, tenantId }).lean();
      if (!listing || listing.status !== TENANT_LISTING_STATUS.ACTIVE) {
        dropped.push({ listingId: item.tenantProductId, title: item.titleSnapshot });
        await CartItem.deleteOne({ _id: item.id });
        continue;
      }
      const stock = await inventoryService.getStock({ tenantId, listingId: listing._id });
      const available = stock.qtyAvailable ?? 0;
      if (available <= 0) {
        dropped.push({ listingId: item.tenantProductId, title: item.titleSnapshot });
        await CartItem.deleteOne({ _id: item.id });
        continue;
      }
      const price = listing.price?.sellingPrice ?? 0;
      await CartItem.updateOne(
        { _id: item.id },
        {
          $set: {
            priceSnapshot: {
              mrp: listing.price?.mrp ?? null,
              sellingPrice: price,
              currency: listing.price?.currency || 'INR',
            },
            stockSnapshot: { availableQty: available, checkedAt: new Date() },
            qty: Math.min(item.qty, available),
            lineTotal: roundMoney(price * Math.min(item.qty, available)),
            updatedAt: new Date(),
          },
        }
      );
    }
    await this.refreshTotals(cart);
    return { refreshed: items.length - dropped.length, dropped };
  }

  /** Checkout: mark the cart checked out and return it (order owns the truth after). */
  async markCheckedOut({ cartId, orderId }) {
    const cart = await Cart.findById(cartId);
    if (!cart) throw notFound('Cart not found', 'CART_NOT_FOUND');
    cart.status = CART_STATUS.CHECKED_OUT;
    cart.checkedOutAt = new Date();
    cart.lastCheckoutMeta = { orderId };
    await cart.save();
    return cart;
  }

  async refreshTotals(cart) {
    const items = await CartItem.find({ cartId: cart._id }).lean();
    const distinct = items.length;
    const count = items.reduce((acc, i) => acc + i.qty, 0);
    const subtotal = items.reduce((acc, i) => acc + (i.lineTotal || 0), 0);
    cart.itemCount = count;
    cart.distinctItems = distinct;
    cart.subtotal = roundMoney(subtotal);
    cart.lastActivityAt = new Date();
    await cart.save();
  }
}

export default new CartService();
