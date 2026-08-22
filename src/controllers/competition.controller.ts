import { Response } from 'express';
import { AuthRequest } from '@/middleware/auth.middleware';
import * as competitionService from '@/services/competition.service';
import logger from '@/utils/logger';

const tournamentIdFrom = (req: AuthRequest): string => req.params.tournamentId as string;

const idempotencyKeyFrom = (req: AuthRequest): string | undefined =>
  req.get('Idempotency-Key') ?? undefined;

const adminIdFrom = (req: AuthRequest): string | undefined => req.user?._id.toString();

const sendError = (res: Response, error: unknown, operation: string) => {
  logger.error(`${operation}:`, error);
  if (error instanceof competitionService.CompetitionError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_COMPETITION_ERROR',
    message: 'Competition operation failed',
  });
};

export const getOverview = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.getCompetitionOverview(tournamentIdFrom(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Get Competition Overview Error');
  }
};

export const updateRules = async (req: AuthRequest, res: Response) => {
  try {
    const { expectedRevision, ...changes } = req.body;
    const data = await competitionService.updateCompetitionRules(
      tournamentIdFrom(req),
      expectedRevision,
      changes
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Update Competition Rules Error');
  }
};

export const listEntries = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.listCompetitionEntries(tournamentIdFrom(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'List Competition Entries Error');
  }
};

export const addEntry = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.addCompetitionEntry(
      tournamentIdFrom(req),
      req.body.teamId,
      req.body.expectedRevision,
      adminIdFrom(req)
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Add Competition Entry Error');
  }
};

export const removeEntry = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.removeCompetitionEntry(
      tournamentIdFrom(req),
      req.params.entryId as string,
      req.body.expectedRevision
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Remove Competition Entry Error');
  }
};

export const assignGroups = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.assignCompetitionGroups(
      tournamentIdFrom(req),
      req.body.expectedRevision,
      req.body.assignments
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Assign Competition Groups Error');
  }
};

export const previewFixtures = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.previewGroupFixtures(
      tournamentIdFrom(req),
      req.body
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Preview Competition Fixtures Error');
  }
};

export const getFixturePlan = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.getPublishedGroupFixturePlan(
      tournamentIdFrom(req)
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Get Official Competition Fixtures Error');
  }
};

export const publishFixtures = async (req: AuthRequest, res: Response) => {
  try {
    const result = await competitionService.publishGroupFixtures(
      tournamentIdFrom(req),
      req.body,
      adminIdFrom(req),
      idempotencyKeyFrom(req)
    );
    res.setHeader('Idempotent-Replayed', String(result.replayed));
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result.data });
  } catch (error) {
    sendError(res, error, 'Publish Competition Fixtures Error');
  }
};

export const getGroupedStandings = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.calculateGroupedStandings(tournamentIdFrom(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Get Grouped Standings Error');
  }
};

export const getRanking = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.getCompetitionRankingState(tournamentIdFrom(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Get Competition Ranking Error');
  }
};

export const resolveTie = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.resolveCompetitionTie(
      tournamentIdFrom(req),
      req.body,
      adminIdFrom(req)
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Resolve Competition Tie Error');
  }
};

export const finalizeQualification = async (req: AuthRequest, res: Response) => {
  try {
    const result = await competitionService.finalizeQualification(
      tournamentIdFrom(req),
      req.body.expectedRevision,
      idempotencyKeyFrom(req)
    );
    res.setHeader('Idempotent-Replayed', String(result.replayed));
    res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    sendError(res, error, 'Finalize Qualification Error');
  }
};

export const createDraw = async (req: AuthRequest, res: Response) => {
  try {
    const result = await competitionService.createKnockoutDraw(
      tournamentIdFrom(req),
      req.body,
      adminIdFrom(req),
      idempotencyKeyFrom(req)
    );
    res.setHeader('Idempotent-Replayed', String(result.replayed));
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result.data });
  } catch (error) {
    sendError(res, error, 'Create Knockout Draw Error');
  }
};

export const listDraws = async (req: AuthRequest, res: Response) => {
  try {
    const data = await competitionService.listCompetitionDraws(tournamentIdFrom(req));
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'List Knockout Draws Error');
  }
};

export const publishDraw = async (req: AuthRequest, res: Response) => {
  try {
    const result = await competitionService.publishKnockoutDraw(
      tournamentIdFrom(req),
      req.params.drawId as string,
      req.body.expectedRevision,
      adminIdFrom(req),
      idempotencyKeyFrom(req)
    );
    res.setHeader('Idempotent-Replayed', String(result.replayed));
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result.data });
  } catch (error) {
    sendError(res, error, 'Publish Knockout Draw Error');
  }
};

export const progressKnockout = async (req: AuthRequest, res: Response) => {
  try {
    const result = await competitionService.progressKnockout(
      tournamentIdFrom(req),
      req.body.expectedRevision,
      adminIdFrom(req),
      idempotencyKeyFrom(req)
    );
    res.setHeader('Idempotent-Replayed', String(result.replayed));
    const statusCode =
      !result.replayed && result.data.action === 'round_advanced' ? 201 : 200;
    res.status(statusCode).json({ success: true, data: result.data });
  } catch (error) {
    sendError(res, error, 'Progress Knockout Error');
  }
};
