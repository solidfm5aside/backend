import { Router } from 'express';
import * as matchController from '@/controllers/match.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate, validateObjectIdParam } from '@/middleware/validate.middleware';
import {
  updateMatchStatusSchema,
  addMatchEventSchema,
  updateMatchDetailsSchema,
  updateMatchWinnerSchema,
} from '@/validators/match.validator';

const router = Router();

// Public routes
router.get('/', matchController.getMatches);

// Admin only routes
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.patch('/:id/status', validateObjectIdParam('id', 'match'), validate(updateMatchStatusSchema), matchController.updateStatus);
router.patch('/:id/details', validateObjectIdParam('id', 'match'), validate(updateMatchDetailsSchema), matchController.updateDetails);
router.patch('/:id/winner', validateObjectIdParam('id', 'match'), validate(updateMatchWinnerSchema), matchController.setWinner);
router.post('/:id/events', validateObjectIdParam('id', 'match'), validate(addMatchEventSchema), matchController.addEvent);
router.delete(
  '/:id/events/:eventId',
  validateObjectIdParam('id', 'match'),
  validateObjectIdParam('eventId', 'event'),
  matchController.deleteEvent
);


export default router;
