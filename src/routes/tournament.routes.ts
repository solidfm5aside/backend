import { Router } from 'express';
import * as tournamentController from '@/controllers/tournament.controller';
import * as competitionController from '@/controllers/competition.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate, validateObjectIdParam } from '@/middleware/validate.middleware';
import {
  createTournamentSchema,
  updateTournamentSchema,
} from '@/validators/tournament.validator';
import {
  addCompetitionEntrySchema,
  assignCompetitionGroupsSchema,
  competitionMutationSchema,
  createCompetitionDrawSchema,
  previewGroupFixturesSchema,
  publishCompetitionDrawSchema,
  publishGroupFixturesSchema,
  resolveCompetitionTieSchema,
  updateCompetitionRulesSchema,
} from '@/validators/competition.validator';

const router = Router();

// Public routes
router.get('/archive', tournamentController.getTournamentArchive);
router.get('/', tournamentController.getTournaments);
router.get('/:tournamentId/bracket', tournamentController.getBracket);
router.get(
  '/:tournamentId/competition/standings',
  validateObjectIdParam('tournamentId', 'tournament'),
  competitionController.getGroupedStandings
);

// Admin only routes
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.get(
  '/:tournamentId/competition',
  validateObjectIdParam('tournamentId', 'tournament'),
  competitionController.getOverview
);
router.get(
  '/:tournamentId/competition/ranking',
  validateObjectIdParam('tournamentId', 'tournament'),
  competitionController.getRanking
);
router.put(
  '/:tournamentId/competition/tie-resolutions',
  validateObjectIdParam('tournamentId', 'tournament'),
  validate(resolveCompetitionTieSchema),
  competitionController.resolveTie
);
router.patch(
  '/:tournamentId/competition/rules',
  validateObjectIdParam('tournamentId', 'tournament'),
  validate(updateCompetitionRulesSchema),
  competitionController.updateRules
);
router.get(
  '/:tournamentId/competition/entries',
  validateObjectIdParam('tournamentId', 'tournament'),
  competitionController.listEntries
);
router.post(
  '/:tournamentId/competition/entries',
  validateObjectIdParam('tournamentId', 'tournament'),
  validate(addCompetitionEntrySchema),
  competitionController.addEntry
);
router.delete(
  '/:tournamentId/competition/entries/:entryId',
  validateObjectIdParam('tournamentId', 'tournament'),
  validateObjectIdParam('entryId', 'entry'),
  validate(competitionMutationSchema),
  competitionController.removeEntry
);
router.put(
  '/:tournamentId/competition/groups',
  validateObjectIdParam('tournamentId', 'tournament'),
  validate(assignCompetitionGroupsSchema),
  competitionController.assignGroups
);
router.post(
  '/:tournamentId/competition/group-fixtures/preview',
  validateObjectIdParam('tournamentId', 'tournament'),
  validate(previewGroupFixturesSchema),
  competitionController.previewFixtures
);
router.get(
  '/:tournamentId/competition/group-fixtures/plan',
  validateObjectIdParam('tournamentId', 'tournament'),
  competitionController.getFixturePlan
);
router.post(
  '/:tournamentId/competition/group-fixtures/publish',
  validateObjectIdParam('tournamentId', 'tournament'),
  validate(publishGroupFixturesSchema),
  competitionController.publishFixtures
);
router.post(
  '/:tournamentId/competition/qualification/finalize',
  validateObjectIdParam('tournamentId', 'tournament'),
  validate(competitionMutationSchema),
  competitionController.finalizeQualification
);
router.get(
  '/:tournamentId/competition/draws',
  validateObjectIdParam('tournamentId', 'tournament'),
  competitionController.listDraws
);
router.post(
  '/:tournamentId/competition/draws',
  validateObjectIdParam('tournamentId', 'tournament'),
  validate(createCompetitionDrawSchema),
  competitionController.createDraw
);
router.post(
  '/:tournamentId/competition/draws/:drawId/publish',
  validateObjectIdParam('tournamentId', 'tournament'),
  validateObjectIdParam('drawId', 'draw'),
  validate(publishCompetitionDrawSchema),
  competitionController.publishDraw
);
router.post(
  '/:tournamentId/competition/knockout/progress',
  validateObjectIdParam('tournamentId', 'tournament'),
  validate(competitionMutationSchema),
  competitionController.progressKnockout
);

router.get('/:id/readiness', tournamentController.checkReadiness);
router.post('/', validate(createTournamentSchema), tournamentController.createTournament);
router.patch(
  '/:id',
  validateObjectIdParam('id', 'tournament'),
  validate(updateTournamentSchema),
  tournamentController.updateTournament
);
export default router;
