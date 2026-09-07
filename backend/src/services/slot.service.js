import DeliverySlot from '../models/deliverySlot.model.js';
import SlotReservation from '../models/slotReservation.model.js';
import Hub from '../models/hub.model.js';
import ServiceablePincode from '../models/serviceablePincode.model.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { SLOT_RESERVATION_STATUS, SLOT_HOLD_TTL_SECONDS } from '../constants/enums.js';
import { roundMoney } from '../utils/money.js';

/**
 * SlotService — BigBasket-style slotted delivery with ATOMIC capacity control.
 *
 * The concurrency trick (doc §3): reservation is a single guarded
 * findOneAndUpdate — `$expr reservedCapacity < totalCapacity` — so concurrent
 * attempts can never oversell. No separate counter to desync.
 *
 * Capacity numbers come from ops (forecasting); this service prevents
 * OVERSELING whatever number is set.
 */
class SlotService {
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

    const dates = [];
    const d = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${toDate}T00:00:00Z`);
    while (d <= end) {
      dates.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }

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
   * DEEP FIX: Upgraded to support date ranges (fromDate/toDate), arrays, or fallback to UTC 'days'.
   * This prevents the timezone trap and supports the frontend's `days: 3` request.
   */
  async listAvailable({ tenantId, pincode, date, fromDate, toDate, days }) {
    let hub;
    try {
      hub = await this.resolveHub({ tenantId, pincode });
    } catch (err) {
      if (err?.code === 'PINCODE_UNSERVICEABLE') {
        return { serviceable: false, pincode: pincode || null, hub: null, slots: [] };
      }
      throw err;
    }
    
    // --- DEEP FIX: Build a robust date filter ---
    let dateQuery;
    if (fromDate && toDate) {
      // Range query (Best practice if Controller passes fromDate/toDate)
      dateQuery = { $gte: fromDate, $lte: toDate };
    } else if (date) {
      // Single date query
      dateQuery = date;
    } else {
      // FALLBACK: Generate UTC dates based on 'days' param (defaults to 3 days)
      // We MUST use UTC methods to match the database format ('YYYY-MM-DD' in UTC)
      const numDays = days || 3; 
      const utcDates = [];
      const now = new Date();
      for (let i = 0; i < numDays; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
        utcDates.push(d.toISOString().slice(0, 10));
      }
      dateQuery = { $in: utcDates };
    }
    // ---------------------------------------------

    const slots = await DeliverySlot.find({
      tenantId, 
      hubId: hub._id, 
      date: dateQuery, // Now safely handles ranges, arrays, or single dates
      status: { $in: ['open', 'full'] },
    }).sort({ date: 1, startTime: 1 }).lean(); // Added date: 1 to sort by day

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

  /**
   * ATOMIC reserve: increments slot reservedCapacity only if capacity remains,
   * then creates a HELD reservation (TTL 10 min).
   */
  async reserve({ tenantId, userId, slotId }) {
    const slot = await DeliverySlot.findOne({ _id: slotId, tenantId });
    if (!slot) throw notFound('Slot not found', 'SLOT_NOT_FOUND');
    if (slot.status === 'cancelled') throw conflict('Slot is unavailable', 'SLOT_UNAVAILABLE');
    if (slot.lastOrderTime && slot.lastOrderTime <= new Date()) {
      throw conflict('Ordering window for this slot has closed', 'SLOT_CUTOFF_PASSED');
    }

    // one live hold per user per slot
    const existingHold = await SlotReservation.findOne({
      slotId, userId, status: SLOT_RESERVATION_STATUS.HELD,
    });
    if (existingHold) {
      if (existingHold.expiresAt > new Date()) return existingHold; // reuse the hold
      await existingHold.updateOne({ $set: { status: SLOT_RESERVATION_STATUS.EXPIRED, releasedAt: new Date() } });
      // decrement capacity back (best-effort; the TTL sweep covers stragglers)
      await this.releaseCapacity({ slotId });
    }

    // ---- THE atomic gate ----
    const updated = await DeliverySlot.findOneAndUpdate(
      {
        _id: slot._id,
        status: { $in: ['open', 'full'] },
        // effective capacity = manualCapacity ?? totalCapacity (Phase 4
        // intraday override) — still atomic, can never oversell
        $expr: { $lt: ['$reservedCapacity', { $ifNull: ['$manualCapacity', '$totalCapacity'] }] },
      },
      { $inc: { reservedCapacity: 1 } },
      { new: true }
    );
    if (!updated) {
      throw conflict('Slot capacity exhausted — please pick another slot', 'SLOT_FULL');
    }

    const now = new Date();
    const reservation = await SlotReservation.create({
      tenantId, slotId, userId,
      status: SLOT_RESERVATION_STATUS.HELD,
      heldAt: now,
      expiresAt: new Date(now.getTime() + SLOT_HOLD_TTL_SECONDS * 1000),
    });
    return reservation;
  }

  /** Confirm a HELD reservation (post-payment) — marks CONFIRMED, keeps capacity reserved. */
  async confirm({ reservationId, tenantId, orderId }) {
    const reservation = await SlotReservation.findOne({ _id: reservationId, tenantId });
    if (!reservation) throw notFound('Slot reservation not found', 'RESERVATION_NOT_FOUND');
    if (reservation.status === SLOT_RESERVATION_STATUS.CONFIRMED) return reservation;
    if (reservation.status !== SLOT_RESERVATION_STATUS.HELD) {
      throw conflict('Reservation is no longer held', 'RESERVATION_NOT_HELD');
    }
    if (reservation.expiresAt < new Date()) {
      throw conflict('Slot hold has expired — please reserve again', 'RESERVATION_EXPIRED');
    }
    reservation.status = SLOT_RESERVATION_STATUS.CONFIRMED;
    reservation.confirmedAt = new Date();
    reservation.orderId = orderId;
    await reservation.save();
    return reservation;
  }

  /** Release a hold (cancellation / compensation / expiry sweep). */
  async release({ reservationId, tenantId, reason = 'released' }) {
    const reservation = await SlotReservation.findOne({ _id: reservationId, tenantId });
    if (!reservation) throw notFound('Slot reservation not found', 'RESERVATION_NOT_FOUND');
    if ([SLOT_RESERVATION_STATUS.EXPIRED, SLOT_RESERVATION_STATUS.RELEASED].includes(reservation.status)) {
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

  /** TTL sweep: expire HELD reservations past expiresAt + release capacity. */
  async sweepExpiredHolds({ limit = 100 }) {
    const expired = await SlotReservation.find({
      status: SLOT_RESERVATION_STATUS.HELD,
      expiresAt: { $lte: new Date() },
    }).limit(limit);
    let released = 0;
    for (const res of expired) {
      res.status = SLOT_RESERVATION_STATUS.EXPIRED;
      res.releasedAt = new Date();
      await res.save();
      await this.releaseCapacity({ slotId: res.slotId });
      released += 1;
    }
    return { scanned: expired.length, released };
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
