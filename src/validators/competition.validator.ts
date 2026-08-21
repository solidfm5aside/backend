import { z } from 'zod';
import {
  CompetitionCommitteeDecisionMethod,
  CompetitionDrawMode,
  CompetitionTieBreaker,
} from '@/models/tournament.model';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
const expectedRevision = z.number().int().min(0);

export const updateCompetitionRulesSchema = z
  .object({
    expectedRevision,
    roundRobinLegs: z.literal(1).optional(),
    qualifiersPerGroup: z.literal(4).optional(),
    tieBreakers: z
      .tuple([
        z.literal(CompetitionTieBreaker.POINTS),
        z.literal(CompetitionTieBreaker.GOAL_DIFFERENCE),
        z.literal(CompetitionTieBreaker.GOALS_FOR),
        z.literal(CompetitionTieBreaker.HEAD_TO_HEAD),
        z.literal(CompetitionTieBreaker.COMMITTEE_DECISION),
      ])
      .optional(),
    drawMode: z.literal(CompetitionDrawMode.SEEDED_CROSS_GROUP).optional(),
    avoidSameGroupFirstRound: z.literal(true).optional(),
    thirdPlaceMatch: z.literal(false).optional(),
    maxRosterPlayers: z.literal(10).optional(),
  })
  .strict();

export const addCompetitionEntrySchema = z.object({
  expectedRevision,
  teamId: objectId,
});

export const competitionMutationSchema = z.object({
  expectedRevision,
});

export const assignCompetitionGroupsSchema = z.object({
  expectedRevision,
  assignments: z
    .array(
      z.object({
        entryId: objectId,
        groupKey: z.enum(['A', 'B']),
        groupSlot: z.number().int().min(1).max(7),
      })
    )
    .length(14, 'Exactly 14 complete group assignments are required'),
});

export const previewGroupFixturesSchema = z.object({
  matchesPerDay: z.number().int().min(3).max(28).optional().default(7),
});

export const publishGroupFixturesSchema = z.object({
  expectedRevision,
  planHash: z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid fixture plan hash'),
  matchesPerDay: z.number().int().min(3).max(28).optional().default(7),
});

export const createCompetitionDrawSchema = z.object({ expectedRevision }).strict();

export const publishCompetitionDrawSchema = z.object({
  expectedRevision,
});

export const resolveCompetitionTieSchema = z
  .object({
    expectedRevision,
    groupKey: z.enum(['A', 'B']),
    basisHash: z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid tie basis hash'),
    orderedTeamIds: z
      .array(objectId)
      .min(2)
      .max(7)
      .refine(
        (teamIds) => new Set(teamIds).size === teamIds.length,
        'Committee order cannot contain a team more than once'
      ),
    method: z.enum(
      Object.values(CompetitionCommitteeDecisionMethod) as [
        CompetitionCommitteeDecisionMethod,
        ...CompetitionCommitteeDecisionMethod[],
      ]
    ),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((body, context) => {
    if (body.method === CompetitionCommitteeDecisionMethod.OTHER && !body.note) {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'A note is required for an other committee decision',
      });
    }
  });
