import { Request, Response } from 'express';
import * as matchService from '@/services/match.service';
import logger from '@/utils/logger';

export const getMatches = async (req: Request, res: Response) => {
  try {
    const { tournamentId, status } = req.query;
    const filter: any = {};
    if (tournamentId) filter.tournamentId = tournamentId;
    if (status) filter.status = status;

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
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to update match status' });
  }
};

export const addEvent = async (req: Request, res: Response) => {
  try {
    const match = await matchService.addMatchEvent(req.params.id as string, req.body);
    res.status(200).json({ success: true, data: match, message: 'Event added successfully' });
  } catch (error: any) {
    logger.error('Add Event Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to add event' });
  }
};
