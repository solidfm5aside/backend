import { Router } from 'express';
import * as matchController from '@/controllers/match.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate } from '@/middleware/validate.middleware';
import { updateMatchStatusSchema, addMatchEventSchema } from '@/validators/match.validator';

const router = Router();

// Public routes
router.get('/', matchController.getMatches);

// Admin only routes
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.patch('/:id/status', validate(updateMatchStatusSchema), matchController.updateStatus);
router.post('/:id/events', validate(addMatchEventSchema), matchController.addEvent);

export default router;
