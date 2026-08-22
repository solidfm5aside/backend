import { Request, Response } from 'express';
import * as tournamentService from '@/services/tournament.service';
import logger from '@/utils/logger';
import { getErrorMessage } from '@/utils/http-error.util';

export const createTournament = async (req: Request, res: Response) => {
  try {
    const tournament = await tournamentService.createTournament(req.body);
    res.status(201).json({ success: true, data: tournament });
  } catch (error: unknown) {
    logger.error('Create Tournament Error:', error);
    const mutationError =
      error instanceof tournamentService.TournamentMutationError ? error : undefined;
    res.status(mutationError?.statusCode ?? 400).json({
      success: false,
      code: mutationError?.code,
      message: getErrorMessage(error, 'Failed to create tournament'),
    });
  }
};

export const getTournaments = async (req: Request, res: Response) => {
  try {
    const tournaments = await tournamentService.getTournaments(req.query);
    res.status(200).json({ success: true, data: tournaments });
  } catch {
    res.status(400).json({ success: false, message: 'Failed to fetch tournaments' });
  }
};

export const updateTournament = async (req: Request, res: Response) => {
  try {
    const tournament = await tournamentService.updateTournament(req.params.id as string, req.body);
    if (!tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found' });
    }
    res.status(200).json({ success: true, data: tournament });
  } catch (error: unknown) {
    const mutationError =
      error instanceof tournamentService.TournamentMutationError ? error : undefined;
    res.status(mutationError?.statusCode ?? 400).json({
      success: false,
      code: mutationError?.code,
      message: getErrorMessage(error, 'Failed to update tournament'),
    });
  }
};

export const getTournamentArchive = async (req: Request, res: Response) => {
  try {
    const archive = await tournamentService.getTournamentArchive();
    res.status(200).json({ success: true, data: archive });
  } catch {
    res.status(400).json({ success: false, message: 'Failed to fetch archive' });
  }
};

export const checkReadiness = async (req: Request, res: Response) => {
  try {
    const readiness = await tournamentService.checkTournamentReadiness(req.params.id as string);
    res.status(200).json({ success: true, data: readiness });
  } catch (error: unknown) {
    logger.error('Check Readiness Error:', error);
    res.status(400).json({
      success: false,
      message: getErrorMessage(error, 'Failed to check readiness'),
    });
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
  } catch (error: unknown) {
    logger.error('Get Bracket Error:', error);
    res.status(400).json({
      success: false,
      message: getErrorMessage(error, 'Failed to fetch bracket data'),
    });
  }
};
