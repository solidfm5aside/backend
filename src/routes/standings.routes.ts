import { Router } from 'express';
import * as standingsController from '@/controllers/standings.controller';

const router = Router();

router.get('/', standingsController.getGlobalStandings);
router.get('/top-scorers', standingsController.getGlobalTopScorers);
router.get('/:tournamentId', standingsController.getStandings);

router.get('/:tournamentId/top-scorers', standingsController.getTopScorers);


export default router;
