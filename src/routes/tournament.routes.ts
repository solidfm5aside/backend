import { Router } from 'express';
import * as tournamentController from '@/controllers/tournament.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate } from '@/middleware/validate.middleware';
import { createTournamentSchema } from '@/validators/tournament.validator';

const router = Router();

router.get('/:id', (req, res) => {
    // Basic placeholder for get details
    res.status(200).json({ success: true, message: 'Tournament details' });
});

// Admin only routes
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.post('/', validate(createTournamentSchema), tournamentController.createTournament);
router.post('/:id/generate-fixtures', tournamentController.generateFixtures);

export default router;
