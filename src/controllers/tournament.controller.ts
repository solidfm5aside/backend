import { Request, Response } from 'express';
import * as tournamentService from '@/services/tournament.service';
import logger from '@/utils/logger';

export const createTournament = async (req: Request, res: Response) => {
  try {
    const tournament = await tournamentService.createTournament(req.body);
    res.status(201).json({ success: true, data: tournament });
  } catch (error) {
    logger.error('Create Tournament Error:', error);
    res.status(400).json({ success: false, message: 'Failed to create tournament' });
  }
};

export const generateFixtures = async (req: Request, res: Response) => {
  try {
    const fixtures = await tournamentService.generateTournamentFixtures(req.params.id as string);
    res.status(200).json({
      success: true,
      message: `Successfully generated ${fixtures.length} fixtures for the league phase.`,
      data: fixtures
    });
  } catch (error: any) {
    logger.error('Generate Fixtures Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to generate fixtures' });
  }
};
