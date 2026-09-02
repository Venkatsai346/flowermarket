import { Router } from 'express';
import { tenantContext } from '../middleware/tenantContext.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import catalogAdminRoutes from './catalog.admin.routes.js';
import catalogTenantRoutes from './catalog.tenant.routes.js';
import catalogPublicRoutes from './catalog.public.routes.js';
import cartRoutes from './cart.routes.js';
import orderRoutes from './order.routes.js';
import returnsRoutes from './returns.routes.js';
import walletRoutes from './wallet.routes.js';
import fulfillmentRoutes from './fulfillment.routes.js';
import riderRoutes from './rider.routes.js';
import policiesRoutes from './policies.routes.js';
import adminRoutes from './admin.routes.js';
import marketplaceRoutes from './marketplace.routes.js';
import mediaRoutes from './media.routes.js';

/**
 * API v1 router.
 * tenantContext runs at the router level so every endpoint has req.tenantId.
 */
const apiRouter = Router();

apiRouter.use(tenantContext);

apiRouter.get('/health', (req, res) =>
  res.status(200).json({ success: true, message: 'OK', data: { service: 'flower-market-api', tenantId: req.tenantId || null } })
);

apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/catalog', catalogPublicRoutes); // customer-facing
apiRouter.use('/catalog/tenant', catalogTenantRoutes); // tenant portal
apiRouter.use('/catalog/admin', catalogAdminRoutes); // central ops

// ---- Phase 3: order lifecycle ----
apiRouter.use('/cart', cartRoutes);          // cart + checkout saga + slot browse/reserve
apiRouter.use('/orders', orderRoutes);       // customer order reads + cancel
apiRouter.use('/returns', returnsRoutes);    // customer returns + ops pickup/QC
apiRouter.use('/wallet', walletRoutes);      // wallet balance/ledger/refunds
apiRouter.use('/fulfillment', fulfillmentRoutes); // picking, delivery, slot ops, refunds ops

// ---- Phase 3.5: rider app, pricing policies, forecasting ----
apiRouter.use('/rider', riderRoutes);            // rider-app delivery state machine
apiRouter.use('/policies', policiesRoutes);      // delivery-fee/tax/coupon/refund policies

// ---- Phase 4: admin dashboard (products/inventory/slots/orders/users/analytics) ----
apiRouter.use('/admin', adminRoutes);

// ---- Phase 5: multi-tenant marketplace ----
apiRouter.use('/marketplace', marketplaceRoutes);

// ---- Media uploads (images & videos) ----
apiRouter.use('/media', mediaRoutes);

export default apiRouter;
