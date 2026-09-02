import { Router } from 'express';
import Joi from 'joi';
import SearchController from '../controllers/search.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES, SEARCH_EVENT_TYPE, RANKING_SIGNAL } from '../constants/enums.js';

const router = Router();

const suggestQuery = Joi.object({ q: Joi.string().min(1).max(80).required() });

const eventSchema = Joi.object({
  queryId: Joi.string().max(64).required(),
  type: Joi.string().valid(...Object.values(SEARCH_EVENT_TYPE)).required(),
  position: Joi.number().integer().min(0).max(500),
  listingId: Joi.string().hex().length(24),
});

const weightKeys = Object.values(RANKING_SIGNAL);
const profileSchema = Joi.object({
  code: Joi.string().lowercase().max(40).required(),
  name: Joi.string().max(80).required(),
  description: Joi.string().max(400).allow(null, ''),
  weights: Joi.object(Object.fromEntries(weightKeys.map((k) => [k, Joi.number().min(0).max(5)]))),
  tuning: Joi.object({
    popularityReference: Joi.number().min(1),
    ctrPrior: Joi.number().min(0).max(1),
    ctrWeight: Joi.number().min(1),
    freshnessHalfLifeHours: Joi.number().min(1),
    lowStockThreshold: Joi.number().min(0),
    promotedBoost: Joi.number().min(0).max(2),
    returnPenalty: Joi.number().min(0).max(2),
    outOfStockFloor: Joi.boolean(),
  }),
  pins: Joi.array().items(Joi.object({
    query: Joi.string().max(80).allow(null, ''),
    listingIds: Joi.array().items(Joi.string().hex().length(24)),
  })),
  buries: Joi.array().items(Joi.string().hex().length(24)),
  isActive: Joi.boolean(),
  isDefault: Joi.boolean(),
  trafficPct: Joi.number().min(0).max(100),
});

const synonymSchema = Joi.object({
  terms: Joi.array().items(Joi.string().lowercase().max(60)).min(2).required(),
  type: Joi.string().valid('equivalent', 'oneway').default('equivalent'),
  from: Joi.string().lowercase().max(60).allow(null, ''),
  note: Joi.string().max(200).allow(null, ''),
  isActive: Joi.boolean(),
});

/**
 * /search — autocomplete, behaviour beacons and the tuning surface.
 *
 * Suggest and the event beacon are PUBLIC: they are called by anonymous
 * shoppers on the storefront, and the beacon carries no identity — only an
 * opaque queryId the server itself minted.
 *
 * Ranking profiles are store-admin scoped: a merchandiser retunes their own
 * store's relevance, which is a business decision, unlike GST rates.
 */
router.get('/suggest', validate(suggestQuery, 'query'), SearchController.suggest);
router.post('/events', validate(eventSchema), SearchController.event);

router.use(authenticate);
const storeAdmin = authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN);

router.get('/profiles', storeAdmin, SearchController.profiles);
router.post('/profiles', storeAdmin, validate(profileSchema), SearchController.saveProfile);
router.get('/synonyms', storeAdmin, SearchController.synonyms);
router.post('/synonyms', storeAdmin, validate(synonymSchema), SearchController.createSynonym);
router.post('/reindex', storeAdmin, SearchController.reindex);
router.get('/health', storeAdmin, SearchController.health);
router.get('/analytics', storeAdmin, SearchController.analytics);

export default router;
