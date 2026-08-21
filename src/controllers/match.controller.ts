import { Request, Response } from 'express';
import * as matchService from '@/services/match.service';
import logger from '@/utils/logger';
import { MatchStage, MatchStatus } from '@/models/match.model';
import { getErrorMessage } from '@/utils/http-error.util';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export const getMatches = async (req: Request, res: Response) => {
  try {
    const { matchId, tournamentId, status, stage, groupKey, round, leg } = req.query;
    const filter: Record<string, string | number> = {};
    if (matchId) {
      if (typeof matchId !== 'string' || !OBJECT_ID_PATTERN.test(matchId)) {
        return res.status(400).json({ success: false, message: 'Invalid match ID' });
      }
      filter.matchId = matchId;
    }
    if (tournamentId) {
      if (typeof tournamentId !== 'string' || !OBJECT_ID_PATTERN.test(tournamentId)) {
        return res.status(400).json({ success: false, message: 'Invalid tournament ID' });
      }
      filter.tournamentId = tournamentId;
    }
    if (status) {
      if (typeof status !== 'string' || !Object.values(MatchStatus).includes(status as MatchStatus)) {
        return res.status(400).json({ success: false, message: 'Invalid match status' });
      }
      filter.status = status;
    }
    if (stage) {
      if (typeof stage !== 'string' || !Object.values(MatchStage).includes(stage as MatchStage)) {
        return res.status(400).json({ success: false, message: 'Invalid match stage' });
      }
      filter.stage = stage;
    }
    if (groupKey) {
      if (groupKey !== 'A' && groupKey !== 'B') {
        return res.status(400).json({ success: false, message: 'groupKey must be A or B' });
      }
      filter.groupKey = groupKey;
    }
    if (round !== undefined) {
      const parsedRound = Number(round);
      if (!Number.isInteger(parsedRound) || parsedRound < 1) {
        return res.status(400).json({ success: false, message: 'round must be a positive integer' });
      }
      filter.round = parsedRound;
    }
    if (leg !== undefined) {
      const parsedLeg = Number(leg);
      if (parsedLeg !== 1 && parsedLeg !== 2) {
        return res.status(400).json({ success: false, message: 'leg must be 1 or 2' });
      }
      filter.leg = parsedLeg;
    }

    const matches = await matchService.getMatches(filter);
    res.status(200).json({ success: true, data: matches });
  } catch (error) {
    logger.error('Get Matches Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch matches' });
  }
};

export const updateStatus = async (req: Request, res: Response) => {
  try {
    const match = await matchService.updateMatchStatus(req.params.id as string, req.body.status);
    if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
    res.status(200).json({ success: true, data: match, message: `Match status updated to ${req.body.status}` });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      message: getErrorMessage(error, 'Failed to update match status'),
    });
  }
};

export const updateDetails = async (req: Request, res: Response) => {
  try {
    const match = await matchService.updateMatchDetails(req.params.id as string, req.body);
    if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
    res.status(200).json({ success: true, data: match, message: 'Match details updated successfully' });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      message: getErrorMessage(error, 'Failed to update match details'),
    });
  }
};

export const addEvent = async (req: Request, res: Response) => {
  try {
    const result = await matchService.addMatchEvent(
      req.params.id as string,
      req.body,
      req.get('Idempotency-Key')
    );
    res.status(200).json({
      success: true,
      data: result,
      message: result.replayed ? 'Event request replayed successfully' : 'Event added successfully',
    });
  } catch (error: unknown) {
    logger.error('Add Event Error:', error);
    res.status(400).json({
      success: false,
      message: getErrorMessage(error, 'Failed to add event'),
    });
  }
};

export const deleteEvent = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const eventId = req.params.eventId as string;
    const match = await matchService.deleteMatchEvent(id, eventId);

    res.status(200).json({ success: true, data: match, message: 'Event deleted successfully' });
  } catch (error: unknown) {
    logger.error('Delete Event Error:', error);
    res.status(400).json({
      success: false,
      message: getErrorMessage(error, 'Failed to delete event'),
    });
  }
};

/**
 * PATCH /matches/:id/winner
 * Sets the advancing winner of a knockout match after Extra Time / Penalty Shootout.
 * Body: { winnerId: string, isExtraTime: boolean, shootoutScore?: { home: number, away: number } }
 */
export const setWinner = async (req: Request, res: Response) => {
  try {
    const { winnerId, isExtraTime, shootoutScore } = req.body;

    if (!winnerId) {
      return res.status(400).json({ success: false, message: 'winnerId is required' });
    }

    const match = await matchService.updateMatchWinner(
      req.params.id as string,
      winnerId,
      !!isExtraTime,
      shootoutScore
    );

    res.status(200).json({
      success: true,
      data: match,
      message: 'Knockout winner set and match completed successfully',
    });
  } catch (error: unknown) {
    logger.error('Set Winner Error:', error);
    res.status(400).json({
      success: false,
      message: getErrorMessage(error, 'Failed to set match winner'),
    });
  }
};
