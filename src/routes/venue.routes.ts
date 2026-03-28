import { Router } from 'express';
import * as venueController from '@/controllers/venue.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate } from '@/middleware/validate.middleware';
import { createVenueSchema, updateVenueSchema } from '@/validators/venue.validator';

const router = Router();

// Public routes (none for venues maybe? Let's keep GET public just in case)
router.get('/', venueController.getVenues);
router.get('/:id', venueController.getVenue);

// Protected routes (Admin only)
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.post('/', validate(createVenueSchema), venueController.createVenue);
router.patch('/:id', validate(updateVenueSchema), venueController.updateVenue);
router.delete('/:id', venueController.deleteVenue);

export default router;
