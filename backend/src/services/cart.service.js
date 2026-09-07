import Cart from '../models/cart.model.js';
import CartItem from '../models/cartItem.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import inventoryService from './inventory.service.js';
import pricingPolicyService from './pricingPolicy.service.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';
import { roundMoney, moneySum, toPaise } from '../utils/money.js';
import config from '../config/index.js';
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
 * - Identity is either `{ userId }` (signed-in) or `{ guestKey }` (anonymous
 *   cookie). Checkout still requires a user — guest carts merge on login.
 */
class CartService {
  constructor() {
    this._indexesReady = false;
  }

  /**
   * Drop the pre-guest unique index `{ tenantId, userId, status }` (which
   * treated missing userId as null and allowed only one guest cart per tenant)
   * and install the named partial indexes from the schema.
   */
  async ensureIndexes() {
    if (this._indexesReady) return;
    try {
      const col = Cart.collection;
      const indexes = await col.indexes();
      for (const idx of indexes) {
        if (idx.name === '_id_') continue;
        const keys = Object.keys(idx.key || {});
        const isOldUserUnique = idx.unique
          && keys.includes('tenantId')
          && keys.includes('userId')
          && keys.includes('status')
          && idx.name !== 'uniq_active_user_cart';
        if (isOldUserUnique) {
          // eslint-disable-next-line no-await-in-loop
          await col.dropIndex(idx.name).catch(() => {});
        }
      }
      await Cart.syncIndexes();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[cart] index sync failed:', err.message);
    }
    this._indexesReady = true;
  }

  /** Authenticated XOR guest. Checkout paths always pass userId. */
  ownerFilter({ tenantId, userId, guestKey }) {
    if (!tenantId) throw badRequest('Tenant required', 'TENANT_REQUIRED');
    if (userId) return { tenantId, userId, status: CART_STATUS.ACTIVE };
    if (guestKey) return { tenantId, guestKey, status: CART_STATUS.ACTIVE };
    throw badRequest('Cart identity missing', 'CART_IDENTITY_REQUIRED');
  }

  emptyCart({ guest = false, guestKey = null } = {}) {
    const dual = config.money.dualWritePaise !== false;
    return {
      id: null,
      status: CART_STATUS.ACTIVE,
      itemCount: 0,
      distinctItems: 0,
      subtotal: 0,
      items: [],
      guest: Boolean(guest),
      ...(guestKey ? { guestKey } : {}),
      ...(dual ? { subtotalPaise: 0 } : {}),
    };
  }

  /** Get the active cart for a user or guest, creating it lazily. */
  async getOrCreateActive({ tenantId, userId, guestKey }) {
    await this.ensureIndexes();
    const q = this.ownerFilter({ tenantId, userId, guestKey });
    let cart = await Cart.findOne(q);
    if (!cart) {
      const doc = { tenantId, status: CART_STATUS.ACTIVE };
      if (userId) doc.userId = userId;
      else doc.guestKey = guestKey;
      cart = await Cart.create(doc);
    }
    return cart;
  }

  /** Internal view: raw cart doc + items. Missing cart → null (GET stays lazy). */
  async fetchCart({ tenantId, userId, guestKey, create = true }) {
    let cart;
    if (create) {
      cart = await this.getOrCreateActive({ tenantId, userId, guestKey });
    } else {
      await this.ensureIndexes();
      try {
        cart = await Cart.findOne(this.ownerFilter({ tenantId, userId, guestKey }));
      } catch {
        cart = null;
      }
    }
    if (!cart) return { cart: null, items: [] };
    const items = await CartItem.find({ cartId: cart._id }).sort({ createdAt: 1 }).lean();
    return { cart, items: serializeList(items) };
  }

  shapeCart(cart, items, { guest = false, guestKey = null } = {}) {
    const plain = cart.toObject ? cart.toObject() : { ...cart };
    const { _id, ...rest } = plain;
    const dual = config.money.dualWritePaise !== false;
    const withPaise = dual
      ? items.map((it) => ({ ...it, lineTotalPaise: toPaise(it.lineTotal || 0) }))
      : items;
    return {
      ...rest,
      id: _id,
      items: withPaise,
      guest: Boolean(guest || rest.guestKey),
      ...(guestKey && !rest.userId ? { guestKey } : {}),
      ...(dual ? { subtotalPaise: toPaise(rest.subtotal || 0) } : {}),
    };
  }

  /**
   * Public cart shape — flat, so clients read `cart.items` / `cart.subtotal`
   * directly: { id, status, itemCount, distinctItems, subtotal, couponCode, …, items }.
   * GET without identity returns an empty virtual cart (no row written).
   */
  async getCart({ tenantId, userId, guestKey }) {
    if (!userId && !guestKey) return this.emptyCart({ guest: true });
    const { cart, items } = await this.fetchCart({ tenantId, userId, guestKey, create: false });
    if (!cart) return this.emptyCart({ guest: !userId, guestKey });
    return this.shapeCart(cart, items, { guest: !userId, guestKey });
  }

  /** Add or increment an item; snapshots price/stock from the live listing. */
  async addItem({ tenantId, userId, guestKey, tenantProductId, qty }) {
    const q = Math.max(1, Math.floor(Number(qty) || 1));
    const cart = await this.getOrCreateActive({ tenantId, userId, guestKey });

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

    if (existing) {
      existing.qty = nextQty;
      existing.lineTotal = lineTotal;
      existing.updatedAt = new Date();
      await existing.save();
    } else {
      await CartItem.create({
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
    return this.getCart({ tenantId, userId, guestKey });
  }

  async updateQty({ tenantId, userId, guestKey, itemId, qty }) {
    const cart = await this.getOrCreateActive({ tenantId, userId, guestKey });
    const item = await CartItem.findOne({ _id: itemId, cartId: cart._id });
    if (!item) throw notFound('Cart item not found', 'CART_ITEM_NOT_FOUND');
    if (qty <= 0) return this.removeItem({ tenantId, userId, guestKey, itemId });

    const listing = await TenantProduct.findOne({ _id: item.tenantProductId, tenantId });
    const stock = listing ? await inventoryService.getStock({ tenantId, listingId: listing._id }) : { qtyAvailable: 0 };
    const available = stock.qtyAvailable ?? 0;
    if (qty > available) throw conflict(`Only ${available} available`, 'INSUFFICIENT_STOCK', { available });

    item.qty = Math.floor(qty);
    item.lineTotal = roundMoney((item.priceSnapshot?.sellingPrice || 0) * item.qty);
    item.updatedAt = new Date();
    await item.save();
    await this.refreshTotals(cart);
    return this.getCart({ tenantId, userId, guestKey });
  }

  async removeItem({ tenantId, userId, guestKey, itemId }) {
    const cart = await this.getOrCreateActive({ tenantId, userId, guestKey });
    await CartItem.deleteOne({ _id: itemId, cartId: cart._id });
    await this.refreshTotals(cart);
    return this.getCart({ tenantId, userId, guestKey });
  }

  async clear({ tenantId, userId, guestKey }) {
    const cart = await this.getOrCreateActive({ tenantId, userId, guestKey });
    await CartItem.deleteMany({ cartId: cart._id });
    await this.refreshTotals(cart);
    return this.getCart({ tenantId, userId, guestKey });
  }

  /**
   * Fold a guest draft into the signed-in cart. Same listing → summed qty
   * (capped at live stock). Guest row is abandoned so the unique guest index
   * frees the key. Idempotent if the guest cart is already gone.
   */
  async mergeGuestCart({ tenantId, userId, guestKey }) {
    if (!tenantId || !userId || !guestKey) {
      return this.getCart({ tenantId, userId });
    }
    await this.ensureIndexes();
    const guest = await Cart.findOne({ tenantId, guestKey, status: CART_STATUS.ACTIVE });
    if (!guest) return this.getCart({ tenantId, userId });

    const userCart = await this.getOrCreateActive({ tenantId, userId });
    if (String(guest._id) === String(userCart._id)) {
      return this.getCart({ tenantId, userId });
    }

    const items = await CartItem.find({ cartId: guest._id });
    for (const it of items) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await CartItem.findOne({ cartId: userCart._id, tenantProductId: it.tenantProductId });
      if (existing) {
        // eslint-disable-next-line no-await-in-loop
        const listing = await TenantProduct.findOne({ _id: it.tenantProductId, tenantId });
        // eslint-disable-next-line no-await-in-loop
        const stock = listing ? await inventoryService.getStock({ tenantId, listingId: listing._id }) : { qtyAvailable: 0 };
        const available = stock.qtyAvailable ?? 0;
        const nextQty = Math.min(existing.qty + it.qty, Math.max(available, existing.qty));
        existing.qty = nextQty;
        existing.lineTotal = roundMoney((existing.priceSnapshot?.sellingPrice || 0) * nextQty);
        existing.updatedAt = new Date();
        // eslint-disable-next-line no-await-in-loop
        await existing.save();
        // eslint-disable-next-line no-await-in-loop
        await CartItem.deleteOne({ _id: it._id });
      } else {
        it.cartId = userCart._id;
        // eslint-disable-next-line no-await-in-loop
        await it.save();
      }
    }

    if (!userCart.couponCode && guest.couponCode) {
      userCart.couponCode = guest.couponCode;
      userCart.couponId = guest.couponId;
    }
    guest.status = CART_STATUS.ABANDONED;
    await guest.save();
    await this.refreshTotals(userCart);
    return this.getCart({ tenantId, userId });
  }

  /**
   * Checkout revalidation — refetch live price + stock per line and return the
   * diff. If any price changed, checkout must NOT proceed until the client
   * re-confirms (passes confirmPriceChanges=true).
   * @returns { changed: boolean, diffs: Array, total: number }
   */
  async revalidate({ tenantId, userId, guestKey }) {
    const { cart, items } = await this.fetchCart({ tenantId, userId, guestKey, create: false });
    if (!cart) return { changed: false, diffs: [], total: 0, itemCount: 0 };
    const diffs = [];
    let changed = false;
    let total = 0;

    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
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
      // eslint-disable-next-line no-await-in-loop
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
  async applyCoupon({ tenantId, userId, guestKey, code }) {
    const { cart } = await this.fetchCart({ tenantId, userId, guestKey });
    const { coupon, discountAmount } = await pricingPolicyService.applyCoupon({
      tenantId, code, userId, cartSubtotal: cart.subtotal,
    });
    cart.couponCode = coupon.code;
    cart.couponId = coupon._id;
    await cart.save();
    const base = await this.getCart({ tenantId, userId, guestKey });
    return { ...base, coupon: { id: coupon._id, code: coupon.code, discountType: coupon.discountType, value: coupon.value, discountAmount } };
  }

  /** Remove the coupon from the cart. */
  async removeCoupon({ tenantId, userId, guestKey }) {
    const { cart } = await this.fetchCart({ tenantId, userId, guestKey });
    cart.couponCode = null;
    cart.couponId = null;
    await cart.save();
    return this.getCart({ tenantId, userId, guestKey });
  }

  /**
   * Apply LIVE prices/stock to cart items (called by checkout AFTER the
   * customer re-confirms a price change). The cart is a disposable draft, so
   * once the customer confirms the new numbers we snap the items to reality:
   *   - priceSnapshot/lineTotal <- live selling price
   *   - qty capped at available stock; zero-stock lines dropped
   * @returns { refreshed, dropped: [{listingId, title}] }
   */
  async applyLivePrices({ tenantId, userId, guestKey }) {
    const { cart, items } = await this.fetchCart({ tenantId, userId, guestKey });
    const dropped = [];
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      const listing = await TenantProduct.findOne({ _id: item.tenantProductId, tenantId }).lean();
      if (!listing || listing.status !== TENANT_LISTING_STATUS.ACTIVE) {
        dropped.push({ listingId: item.tenantProductId, title: item.titleSnapshot });
        // eslint-disable-next-line no-await-in-loop
        await CartItem.deleteOne({ _id: item.id });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const stock = await inventoryService.getStock({ tenantId, listingId: listing._id });
      const available = stock.qtyAvailable ?? 0;
      if (available <= 0) {
        dropped.push({ listingId: item.tenantProductId, title: item.titleSnapshot });
        // eslint-disable-next-line no-await-in-loop
        await CartItem.deleteOne({ _id: item.id });
        continue;
      }
      const price = listing.price?.sellingPrice ?? 0;
      // eslint-disable-next-line no-await-in-loop
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
