import { Request, Response } from 'express';
import * as standingsService from '@/services/standings.service';
import logger from '@/utils/logger';

export const getStandings = async (req: Request, res: Response) => {
  try {
    const standings = await standingsService.getTournamentStandings(req.params.tournamentId as string);
    res.status(200).json({ success: true, data: standings });
  } catch (error) {
    logger.error('Get Standings Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch standings' });
  }
};

export const getTopScorers = async (req: Request, res: Response) => {
  try {
    const scorers = await standingsService.getTopScorers(req.params.tournamentId as string);
    res.status(200).json({ success: true, data: scorers });
  } catch (error) {
    logger.error('Get Top Scorers Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch top scorers' });
  }
};

