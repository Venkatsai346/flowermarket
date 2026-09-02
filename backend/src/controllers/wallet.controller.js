import walletService from '../services/wallet.service.js';
import refundService from '../services/refund.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';

/**
 * WalletController — customer wallet (default refund destination) + ledger.
 */
class WalletController {
  balance = asyncHandler(async (req, res) => {
    const wallet = await walletService.getOrCreate({
      tenantId: req.tenantId, userId: req.auth.userId,
    });
    res.status(200).json(success(wallet, { message: 'Wallet fetched' }));
  });

  ledger = asyncHandler(async (req, res) => {
    const result = await walletService.ledger({
      tenantId: req.tenantId, userId: req.auth.userId,
      page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20,
    });
    res.status(200).json(success(result.items, { message: 'Wallet transactions', meta: result.meta }));
  });

  /** Customer view of their refunds. */
  refunds = asyncHandler(async (req, res) => {
    const result = await refundService.list({
      tenantId: req.tenantId, userId: req.auth.userId, query: req.query,
    });
    res.status(200).json(success(result.items, { message: 'Refunds fetched', meta: result.meta }));
  });
}

export default new WalletController();
