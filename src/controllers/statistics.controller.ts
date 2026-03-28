import { Request, Response } from 'express';
import * as StandingsService from '@/services/standings.service';
import logger from '@/utils/logger';

export const getTopScorers = async (req: Request, res: Response) => {
  try {
    const { tournamentId } = req.params;
    const scorers = await StandingsService.getTopScorers(tournamentId);
    
    res.status(200).json({
      success: true,
      data: scorers
    });
  } catch (error: any) {
    logger.error('Error fetching top scorers:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch top scorers'
    });
  }
};

export const getStandings = async (req: Request, res: Response) => {
  try {
    const { tournamentId } = req.params;
    const standings = await StandingsService.getTournamentStandings(tournamentId);
    
    res.status(200).json({
      success: true,
      data: standings
    });
  } catch (error: any) {
    logger.error('Error fetching standings:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch standings'
    });
  }
};
