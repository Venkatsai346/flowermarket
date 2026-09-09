/**
 * ReferralService — organic growth via customer referrals.
 *
 * Flow:
 *   1. Customer gets a unique referral code
 *   2. Shares with friends
 *   3. Friend signs up using the code
 *   4. Both get rewards (referrer: ₹50 credit, referred: ₹25 off first order)
 *
 * Anti-fraud: one referral per phone/email, no self-referrals.
 */

import User from '../models/user.model.js';
import Wallet from '../models/wallet.model.js';
import WalletTransaction from '../models/walletTransaction.model.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import crypto from 'node:crypto';

const REFERRER_REWARD_PAISE = 5000; // ₹50
const REFERRED_DISCOUNT_PAISE = 2500; // ₹25

class ReferralService {
  /**
   * Generate or get a user's referral code.
   */
  async getCode({ tenantId, userId }) {
    const user = await User.findOne({ _id: userId, tenantId });
    if (!user) throw notFound('User not found', 'USER_NOT_FOUND');

    if (user.referralCode) return { code: user.referralCode };

    const code = this._generateCode(user.name || user.phone?.number || 'USER');
    user.referralCode = code;
    await user.save();
    return { code };
  }

  /**
   * Apply a referral code during signup.
   */
  async apply({ tenantId, userId, code }) {
    if (!code) throw badRequest('Referral code required', 'NO_CODE');

    const referrer = await User.findOne({ tenantId, referralCode: code });
    if (!referrer) throw notFound('Invalid referral code', 'INVALID_CODE');
    if (String(referrer._id) === String(userId)) throw badRequest('Cannot refer yourself', 'SELF_REFERRAL');

    const referred = await User.findOne({ _id: userId, tenantId });
    if (!referred) throw notFound('User not found', 'USER_NOT_FOUND');
    if (referred.referredBy) throw conflict('Already referred', 'ALREADY_REFERRED');

    // Mark referral
    referred.referredBy = referrer._id;
    await referred.save();

    // Credit referrer
    const referrerWallet = await this._getOrCreateWallet(tenantId, referrer._id);
    referrerWallet.balance += REFERRER_REWARD_PAISE;
    await referrerWallet.save();

    await WalletTransaction.create({
      walletId: referrerWallet._id, tenantId,
      userId: referrer._id, type: 'credit',
      amount: REFERRER_REWARD_PAISE, reason: 'referral_reward',
      ref: String(userId), description: 'Referral reward',
    });

    // Credit referred user (first-order discount)
    const referredWallet = await this._getOrCreateWallet(tenantId, userId);
    referredWallet.balance += REFERRED_DISCOUNT_PAISE;
    await referredWallet.save();

    await WalletTransaction.create({
      walletId: referredWallet._id, tenantId,
      userId, type: 'credit',
      amount: REFERRED_DISCOUNT_PAISE, reason: 'referral_welcome',
      ref: String(referrer._id), description: 'Welcome discount',
    });

    return {
      referrerReward: REFERRER_REWARD_PAISE,
      referredDiscount: REFERRED_DISCOUNT_PAISE,
    };
  }

  /**
   * Get referral stats for a user.
   */
  async stats({ tenantId, userId }) {
    const user = await User.findOne({ _id: userId, tenantId }).lean();
    const referrals = await User.countDocuments({ tenantId, referredBy: userId });

    return {
      code: user?.referralCode || null,
      totalReferrals: referrals,
      totalEarned: referrals * REFERRER_REWARD_PAISE,
    };
  }

  async _getOrCreateWallet(tenantId, userId) {
    let wallet = await Wallet.findOne({ tenantId, userId, type: 'referral' });
    if (!wallet) {
      wallet = await Wallet.create({
        tenantId, userId, type: 'referral',
        balance: 0, totalEarned: 0, currency: 'INR',
      });
    }
    return wallet;
  }

  _generateCode(seed) {
    return crypto.createHash('sha256').update(seed + Date.now().toString()).digest('hex').slice(0, 8).toUpperCase();
  }
}

export default new ReferralService();
