import { Router } from 'express';
import * as StatisticsController from '@/controllers/statistics.controller';

const router = Router();

router.get('/:tournamentId/standings', StatisticsController.getStandings);
router.get('/:tournamentId/top-scorers', StatisticsController.getTopScorers);

export default router;
