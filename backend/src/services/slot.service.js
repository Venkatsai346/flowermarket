import DeliverySlot from '../models/deliverySlot.model.js';
import SlotReservation from '../models/slotReservation.model.js';
import Hub from '../models/hub.model.js';
import ServiceablePincode from '../models/serviceablePincode.model.js';
import Order from '../models/order.model.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { SLOT_RESERVATION_STATUS, SLOT_HOLD_TTL_SECONDS, ORDER_STATUS } from '../constants/enums.js';
import { kolkataDate, eachYmdInclusive } from '../utils/calendar.js';

/** Checkout/payment window — longer than the browse hold so capture can finish. */
const SLOT_CHECKOUT_HOLD_TTL_SECONDS = 20 * 60;

/**
 * SlotService — BigBasket-style slotted delivery with ATOMIC capacity control.
 *
 * Holds are application-swept (never Mongo TTL). Mongo TTL used to delete the
 * HELD row without decrementing reservedCapacity, leaking the slot forever.
 * One live hold per user; switching slots releases the previous hold first.
 */
class SlotService {
  constructor() {
    this._indexesReady = false;
  }

  /**
   * Drop the destructive TTL index (it deleted HELD docs without releasing
   * capacity) and the old per-(user,slot) unique so one hold per user can
   * be enforced. Safe to call on every request; no-ops after the first.
   */
  async ensureIndexes() {
    if (this._indexesReady) return;
    try {
      const col = SlotReservation.collection;
      const indexes = await col.indexes();
      for (const idx of indexes) {
        if (idx.name === '_id_') continue;
        const isTtl = idx.expireAfterSeconds != null;
        const keys = Object.keys(idx.key || {});
        const isOldSlotUserUnique = idx.unique
          && keys.includes('slotId')
          && keys.includes('userId')
          && keys.includes('status');
        if (isTtl || isOldSlotUserUnique) {
          // eslint-disable-next-line no-await-in-loop
          await col.dropIndex(idx.name).catch(() => {});
        }
      }
      await SlotReservation.syncIndexes();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[slot] index sync failed:', err.message);
    }
    this._indexesReady = true;
  }

  /**
   * Resolve the servicing hub for a pincode.
   *
   * When a pin is given it is the front door: an unmapped or unserviceable
   * pin is a hard miss (`PINCODE_UNSERVICEABLE`). The first-active-hub
   * fallback is ONLY used when the caller omitted a pin (ops tools, tests
   * that browse slots without an address).
   */
  async resolveHub({ tenantId, pincode }) {
    const pin = pincode == null || pincode === '' ? null : String(pincode).trim();
    if (pin) {
      const sp = await ServiceablePincode.findOne({ tenantId, pincode: pin, isServiceable: true }).lean();
      if (sp?.hubId) {
        const hub = await Hub.findOne({ _id: sp.hubId, isActive: true });
        if (hub) return hub;
      }
      throw badRequest(`We don't deliver to ${pin} yet`, 'PINCODE_UNSERVICEABLE');
    }
    const hub = await Hub.findOne({ tenantId, isActive: true }).sort({ createdAt: 1 });
    if (!hub) throw notFound('No active hub configured for this tenant', 'HUB_NOT_FOUND');
    return hub;
  }

  /** Checkout/quote gate: an address pin must map to a live hub. */
  async assertServiceable({ tenantId, pincode }) {
    const pin = pincode == null || pincode === '' ? null : String(pincode).trim();
    if (!pin) throw badRequest('Delivery pincode is required', 'PINCODE_REQUIRED');
    return this.resolveHub({ tenantId, pincode: pin });
  }

  /**
   * Generate slots for a date window (ops/admin; also lazily called by the
   * customer query so the demo works without a separate cron).
   * Window templates: 8-10, 10-1, 1-4, 4-7, 7-10 (30-min to 3-hr windows).
   */
  async generateForDates({ tenantId, hubId, fromDate, toDate, capacity = null, overwrite = false, forecast = false }) {
    const hub = await Hub.findOne({ _id: hubId, tenantId });
    if (!hub) throw notFound('Hub not found', 'HUB_NOT_FOUND');
    const cap = capacity || hub.defaultSlotCapacity || 50;

    const templates = [
      { start: '08:00', end: '10:00', label: '8 AM – 10 AM', type: 'normal' },
      { start: '10:00', end: '13:00', label: '10 AM – 1 PM', type: 'normal' },
      { start: '13:00', end: '16:00', label: '1 PM – 4 PM', type: 'normal' },
      { start: '16:00', end: '19:00', label: '4 PM – 7 PM', type: 'normal' },
      { start: '19:00', end: '22:00', label: '7 PM – 10 PM', type: 'normal' },
    ];

    const start = fromDate || kolkataDate(0);
    const end = toDate || start;
    const dates = eachYmdInclusive(start, end);

    // ---- Phase 3.5: nightly forecast batch. "Forecasting sets the number;
    //      the atomic lock enforces it." When forecast=true, per-hub-day
    //      capacity comes from SlotForecastingService (historical volume +
    //      fulfillment-time feedback + physical picker/rider limits); the
    //      DeliverySlot document remains the atomic counter at order time. ----
    const { default: slotForecastingService } = await import('./slotForecasting.service.js');
    const forecastByDate = forecast ? {} : null;
    if (forecast) {
      for (const date of dates) {
        const f = await slotForecastingService.forecastHubDay({
          tenantId, hubId, date, dryRun: false,
        });
        forecastByDate[date] = f;
      }
    }

    let created = 0;
    for (const date of dates) {
      const dayForecast = forecast ? (forecastByDate[date]?.recommendedCapacity || {}) : {};
      for (const t of templates) {
        // forecast capacity per window type (normal/express), floor at physical min
        const fc = dayForecast[t.type] ?? dayForecast.normal ?? null;
        const totalCapacity = forecast ? Math.max(5, fc ?? cap) : cap;
        const filter = { tenantId, hubId, date, startTime: t.start };
        const patch = {
          $setOnInsert: {
            endTime: t.end, windowType: t.type, displayLabel: t.label,
            totalCapacity, reservedCapacity: 0, status: 'open', lastOrderTime: null,
          },
        };
        // nightly batch (forecast) adjusts capacity on EXISTING slots too;
        // explicit overwrite flag does the same for manual regen
        if (forecast || overwrite) {
          patch.$set = { ...(patch.$set || {}), totalCapacity, status: 'open' };
        }
        const res = await DeliverySlot.updateOne(filter, patch, { upsert: true });
        if (res.upsertedCount) created += 1;
      }
    }
    return { created, window: { fromDate, toDate }, hubId, forecast: Boolean(forecast) };
  }

  /**
   * Customer slot picker. Dates are Asia/Kolkata civil days (YYYY-MM-DD).
   * Missing days are generated lazily so the storefront never shows an empty
   * calendar just because ops has not run the nightly job.
   */
  async listAvailable({ tenantId, pincode, date, fromDate, toDate, days }) {
    await this.ensureIndexes();
    let hub;
    try {
      hub = await this.resolveHub({ tenantId, pincode });
    } catch (err) {
      if (err?.code === 'PINCODE_UNSERVICEABLE') {
        return { serviceable: false, pincode: pincode || null, hub: null, slots: [] };
      }
      throw err;
    }

    const windowFrom = fromDate || date || kolkataDate(0);
    const windowTo = toDate || date || kolkataDate(Math.max(0, (Number(days) || 3) - 1));
    await this.generateForDates({
      tenantId, hubId: hub._id, fromDate: windowFrom, toDate: windowTo,
    }).catch(() => {});

    const slots = await DeliverySlot.find({
      tenantId,
      hubId: hub._id,
      date: { $gte: windowFrom, $lte: windowTo },
      status: { $in: ['open', 'full'] },
    }).sort({ date: 1, startTime: 1 }).lean();

    const now = new Date();
    const result = slots.map((s) => {
      const effective = s.manualCapacity ?? s.totalCapacity;
      const remaining = Math.max(0, effective - s.reservedCapacity);
      const cutOffPassed = s.lastOrderTime && s.lastOrderTime <= now;
      return {
        id: s._id,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        displayLabel: s.displayLabel || `${s.startTime} – ${s.endTime}`,
        windowType: s.windowType,
        remaining,
        status: cutOffPassed || remaining <= 0 ? 'closed' : (remaining > 0 ? 'open' : 'full'),
        minOrderValue: s.minOrderValue,
        codAllowed: s.codAllowed,
        hub: { id: hub._id, name: hub.name },
      };
    });

    return {
      serviceable: true,
      pincode: pincode || null,
      hub: { id: hub._id, name: hub.name },
      slots: result,
    };
  }

  holdExpiresAt(ttlSeconds = SLOT_HOLD_TTL_SECONDS) {
    return new Date(Date.now() + ttlSeconds * 1000);
  }

  /**
   * ATOMIC reserve: increments slot reservedCapacity only if capacity remains,
   * then creates a HELD reservation. One live hold per user — a previous hold
   * on another slot is released first. Reuse of the same slot extends TTL.
   */
  async reserve({ tenantId, userId, slotId }) {
    await this.ensureIndexes();
    const slot = await DeliverySlot.findOne({ _id: slotId, tenantId });
    if (!slot) throw notFound('Slot not found', 'SLOT_NOT_FOUND');
    if (slot.status === 'cancelled' || slot.status === 'closed') {
      throw conflict('Slot is unavailable', 'SLOT_UNAVAILABLE');
    }
    if (slot.lastOrderTime && slot.lastOrderTime <= new Date()) {
      throw conflict('Ordering window for this slot has closed', 'SLOT_CUTOFF_PASSED');
    }

    const now = new Date();
    const liveHolds = await SlotReservation.find({
      userId, tenantId, status: SLOT_RESERVATION_STATUS.HELD,
    });

    for (const h of liveHolds) {
      if (String(h.slotId) === String(slotId) && h.expiresAt > now) {
        h.expiresAt = this.holdExpiresAt();
        await h.save();
        return h;
      }
      // other slot, or same slot already expired — free the capacity
      // eslint-disable-next-line no-await-in-loop
      await this.expireHold(h, String(h.slotId) === String(slotId) ? 'expired' : 'switched_slot');
    }

    // ---- THE atomic gate ----
    const updated = await DeliverySlot.findOneAndUpdate(
      {
        _id: slot._id,
        status: { $in: ['open', 'full'] },
        $expr: { $lt: ['$reservedCapacity', { $ifNull: ['$manualCapacity', '$totalCapacity'] }] },
      },
      { $inc: { reservedCapacity: 1 } },
      { new: true }
    );
    if (!updated) {
      throw conflict('Slot capacity exhausted — please pick another slot', 'SLOT_FULL');
    }

    try {
      const reservation = await SlotReservation.create({
        tenantId, slotId, userId,
        status: SLOT_RESERVATION_STATUS.HELD,
        heldAt: now,
        expiresAt: this.holdExpiresAt(),
      });
      return reservation;
    } catch (err) {
      await this.releaseCapacity({ slotId });
      throw err;
    }
  }

  /**
   * Confirm a HELD reservation (post-payment). A hold that is already linked
   * to THIS order is allowed even if the clock expired during capture.
   */
  async confirm({ reservationId, tenantId, orderId }) {
    const reservation = await SlotReservation.findOne({ _id: reservationId, tenantId });
    if (!reservation) throw notFound('Slot reservation not found', 'RESERVATION_NOT_FOUND');
    if (reservation.status === SLOT_RESERVATION_STATUS.CONFIRMED) return reservation;
    if (reservation.status !== SLOT_RESERVATION_STATUS.HELD) {
      throw conflict('Reservation is no longer held', 'RESERVATION_NOT_HELD');
    }
    const linkedToThisOrder = orderId && reservation.orderId
      && String(reservation.orderId) === String(orderId);
    if (!linkedToThisOrder && reservation.expiresAt && reservation.expiresAt < new Date()) {
      throw conflict('Slot hold has expired — please reserve again', 'RESERVATION_EXPIRED');
    }
    reservation.status = SLOT_RESERVATION_STATUS.CONFIRMED;
    reservation.confirmedAt = new Date();
    reservation.orderId = orderId || reservation.orderId;
    await reservation.save();
    return reservation;
  }

  /** Stretch a live hold (checkout / payment window) and optionally pin the order. */
  async extendHold({ reservationId, tenantId, orderId = null, ttlSeconds = SLOT_CHECKOUT_HOLD_TTL_SECONDS }) {
    const patch = { expiresAt: this.holdExpiresAt(ttlSeconds) };
    if (orderId) patch.orderId = orderId;
    const reservation = await SlotReservation.findOneAndUpdate(
      { _id: reservationId, tenantId, status: SLOT_RESERVATION_STATUS.HELD },
      { $set: patch },
      { new: true }
    );
    return reservation;
  }

  async expireHold(reservation, reason = 'expired') {
    if (![SLOT_RESERVATION_STATUS.HELD].includes(reservation.status)) return reservation;
    reservation.status = reason === 'switched_slot'
      ? SLOT_RESERVATION_STATUS.RELEASED
      : SLOT_RESERVATION_STATUS.EXPIRED;
    reservation.releasedAt = new Date();
    reservation.releasedReason = reason;
    await reservation.save();
    await this.releaseCapacity({ slotId: reservation.slotId });
    return reservation;
  }

  /** Release a hold (cancellation / compensation / expiry sweep). */
  async release({ reservationId, tenantId, reason = 'released' }) {
    const reservation = await SlotReservation.findOne({ _id: reservationId, tenantId });
    if (!reservation) throw notFound('Slot reservation not found', 'RESERVATION_NOT_FOUND');
    if ([SLOT_RESERVATION_STATUS.EXPIRED, SLOT_RESERVATION_STATUS.RELEASED].includes(reservation.status)) {
      return reservation;
    }
    if (reservation.status === SLOT_RESERVATION_STATUS.CONFIRMED) {
      reservation.status = SLOT_RESERVATION_STATUS.RELEASED;
      reservation.releasedAt = new Date();
      reservation.releasedReason = reason;
      await reservation.save();
      await this.releaseCapacity({ slotId: reservation.slotId });
      return reservation;
    }
    reservation.status = SLOT_RESERVATION_STATUS.RELEASED;
    reservation.releasedAt = new Date();
    reservation.releasedReason = reason;
    await reservation.save();
    await this.releaseCapacity({ slotId: reservation.slotId });
    return reservation;
  }

  /** Decrement slot reservedCapacity (only if > 0). */
  async releaseCapacity({ slotId }) {
    await DeliverySlot.updateOne(
      { _id: slotId, reservedCapacity: { $gt: 0 } },
      { $inc: { reservedCapacity: -1 } }
    );
  }

  /**
   * Application sweep: expire HELD reservations past expiresAt and give
   * capacity back. Holds pinned to a PAYMENT_PENDING order are extended,
   * never dropped — the customer is still on the gateway.
   */
  async sweepExpiredHolds({ limit = 100 }) {
    await this.ensureIndexes();
    const expired = await SlotReservation.find({
      status: SLOT_RESERVATION_STATUS.HELD,
      expiresAt: { $lte: new Date() },
    }).limit(limit);
    let released = 0;
    let extended = 0;
    for (const res of expired) {
      if (res.orderId) {
        // eslint-disable-next-line no-await-in-loop
        const order = await Order.findById(res.orderId).select('status');
        if (order && order.status === ORDER_STATUS.PAYMENT_PENDING) {
          res.expiresAt = this.holdExpiresAt(SLOT_CHECKOUT_HOLD_TTL_SECONDS);
          // eslint-disable-next-line no-await-in-loop
          await res.save();
          extended += 1;
          continue;
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await this.expireHold(res, 'expired');
      released += 1;
    }
    return { scanned: expired.length, released, extended };
  }

  /** Ops view: capacity utilization for a hub + date. */
  async utilization({ tenantId, hubId, date }) {
    const slots = await DeliverySlot.find({ tenantId, hubId, date }).sort({ startTime: 1 }).lean();
    return slots.map((s) => {
      const effective = s.manualCapacity ?? s.totalCapacity;
      return {
        id: s._id,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        total: effective,
        baseCapacity: s.totalCapacity,
        manualCapacity: s.manualCapacity,
        reserved: s.reservedCapacity,
        remaining: Math.max(0, effective - s.reservedCapacity),
        status: s.status,
      };
    });
  }
}

export default new SlotService();
