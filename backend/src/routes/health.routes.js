import { Router } from 'express';
import HealthController from '../controllers/health.controller.js';

const router = Router();

/**
 * Health check routes — mounted at /health.
 *
 * Liveness  (GET /health)       — always 200 if process alive
 * Readiness (GET /health/ready) — 503 if MongoDB down
 * Deep      (GET /health/deep)  — full dependency report
 */
router.get('/', HealthController.liveness);
router.get('/ready', HealthController.readiness);
router.get('/deep', HealthController.deep);

export default router;
