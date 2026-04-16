import { Router } from 'express';
import * as tournamentController from '@/controllers/tournament.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate } from '@/middleware/validate.middleware';
import { createTournamentSchema } from '@/validators/tournament.validator';

const router = Router();

// Public routes
router.get('/archive', tournamentController.getTournamentArchive);
router.get('/', tournamentController.getTournaments);
router.get('/:tournamentId/bracket', tournamentController.getBracket);

// Admin only routes
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.get('/:id/readiness', tournamentController.checkReadiness);
router.post('/', validate(createTournamentSchema), tournamentController.createTournament);
router.patch('/:id', tournamentController.updateTournament);
router.post('/:tournamentId/generate-fixtures', tournamentController.generateFixtures);
router.post('/:tournamentId/generate-knockout', tournamentController.generateKnockout);

export default router;
