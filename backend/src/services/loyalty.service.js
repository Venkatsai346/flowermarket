/**
 * LoyaltyService — points-based loyalty program.
 *
 * Points are earned on purchases and can be redeemed for discounts.
 *   - Earn: 1 point per ₹100 spent (configurable)
 *   - Redeem: 100 points = ₹10 discount (configurable)
 *   - Tiers: Bronze (0), Silver (5000), Gold (20000), Platinum (50000)
 */

import Wallet from '../models/wallet.model.js';
import WalletTransaction from '../models/walletTransaction.model.js';
import { serializeList } from '../utils/serialize.js';

const TIER_THRESHOLDS = { bronze: 0, silver: 5000, gold: 20000, platinum: 50000 };
const EARN_RATE = 1; // points per ₹100
const REDEEM_RATE = 10; // ₹ discount per 100 points

class LoyaltyService {
  /**
   * Award points for a purchase.
   */
  async earn({ tenantId, userId, orderId, amountPaise }) {
    const points = Math.floor(amountPaise / 10000); // ₹100 = 100 paise * 100 = 1 point
    if (points <= 0) return { points: 0 };

    // Credit to wallet as loyalty balance
    const wallet = await this._getOrCreateWallet(tenantId, userId);
    wallet.balance += points;
    wallet.totalEarned += points;
    await wallet.save();

    await WalletTransaction.create({
      walletId: wallet._id,
      tenantId,
      userId,
      type: 'credit',
      amount: points,
      reason: 'loyalty_earn',
      ref: orderId,
      description: `Earned ${points} loyalty points`,
    });

    const tier = this._tierFor(wallet.totalEarned);
    return { points, balance: wallet.balance, tier };
  }

  /**
   * Redeem points for a discount.
   */
  async redeem({ tenantId, userId, points }) {
    const wallet = await this._getOrCreateWallet(tenantId, userId);
    if (wallet.balance < points) {
      throw new Error('Insufficient loyalty points');
    }

    const discountPaise = Math.floor((points / 100) * REDEEM_RATE * 100);
    wallet.balance -= points;
    await wallet.save();

    await WalletTransaction.create({
      walletId: wallet._id,
      tenantId,
      userId,
      type: 'debit',
      amount: points,
      reason: 'loyalty_redeem',
      description: `Redeemed ${points} points for ₹${discountPaise / 100} discount`,
    });

    return { points, discountPaise, balance: wallet.balance };
  }

  /**
   * Get loyalty status for a user.
   */
  async status({ tenantId, userId }) {
    const wallet = await this._getOrCreateWallet(tenantId, userId);
    const tier = this._tierFor(wallet.totalEarned);
    const nextTier = this._nextTier(wallet.totalEarned);
    const pointsToNext = nextTier ? nextTier.threshold - wallet.totalEarned : 0;

    return {
      balance: wallet.balance,
      totalEarned: wallet.totalEarned,
      tier,
      nextTier: nextTier?.name || null,
      pointsToNext,
      redeemableValue: Math.floor((wallet.balance / 100) * REDEEM_RATE * 100),
    };
  }

  async _getOrCreateWallet(tenantId, userId) {
    let wallet = await Wallet.findOne({ tenantId, userId, type: 'loyalty' });
    if (!wallet) {
      wallet = await Wallet.create({
        tenantId, userId, type: 'loyalty',
        balance: 0, totalEarned: 0, currency: 'INR',
      });
    }
    return wallet;
  }

  _tierFor(totalEarned) {
    if (totalEarned >= TIER_THRESHOLDS.platinum) return 'platinum';
    if (totalEarned >= TIER_THRESHOLDS.gold) return 'gold';
    if (totalEarned >= TIER_THRESHOLDS.silver) return 'silver';
    return 'bronze';
  }

  _nextTier(totalEarned) {
    for (const [name, threshold] of Object.entries(TIER_THRESHOLDS)) {
      if (totalEarned < threshold) return { name, threshold };
    }
    return null;
  }
}

export default new LoyaltyService();
