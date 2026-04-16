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

export const getTournaments = async (req: Request, res: Response) => {
  try {
    const tournaments = await tournamentService.getTournaments(req.query);
    res.status(200).json({ success: true, data: tournaments });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to fetch tournaments' });
  }
};

export const updateTournament = async (req: Request, res: Response) => {
  try {
    const tournament = await tournamentService.updateTournament(req.params.id as string, req.body);
    res.status(200).json({ success: true, data: tournament });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to update tournament' });
  }
};

export const getTournamentArchive = async (req: Request, res: Response) => {
  try {
    const archive = await tournamentService.getTournamentArchive();
    res.status(200).json({ success: true, data: archive });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to fetch archive' });
  }
};

export const checkReadiness = async (req: Request, res: Response) => {
  try {
    const readiness = await tournamentService.checkTournamentReadiness(req.params.id as string);
    res.status(200).json({ success: true, data: readiness });
  } catch (error: any) {
    logger.error('Check Readiness Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to check readiness' });
  }
};

export const generateFixtures = async (req: any, res: Response) => {
  try {
    const { tournamentId } = req.params;
    const { numRounds, matchesPerDay } = req.body;
    
    // Check if user is super_admin
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can generate fixtures' });
    }

    const matches = await tournamentService.generateTournamentFixtures(
      tournamentId, 
      numRounds ? parseInt(numRounds) : 6,
      matchesPerDay ? parseInt(matchesPerDay) : 7
    );
    res.status(200).json({ success: true, data: matches });
  } catch (error: any) {
    logger.error('Generate Fixtures Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to generate fixtures' });
  }
};

export const generateKnockout = async (req: any, res: Response) => {
  try {
    const { tournamentId } = req.params;
    const { stage } = req.body;
    
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can generate knockout fixtures' });
    }

    const matches = await tournamentService.generateKnockoutFixtures(tournamentId, stage);
    res.status(200).json({ success: true, data: matches });
  } catch (error: any) {
    logger.error('Generate Knockout Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to generate knockout fixtures' });
  }
};

/**
 * GET /tournaments/:tournamentId/bracket  (Public)
 * Returns structured bracket data for all knockout stages.
 */
export const getBracket = async (req: Request, res: Response) => {
  try {
    const bracket = await tournamentService.getBracketData(req.params.tournamentId as string);
    res.status(200).json({ success: true, data: bracket });
  } catch (error: any) {
    logger.error('Get Bracket Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to fetch bracket data' });
  }
};
