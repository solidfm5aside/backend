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
    drawMode: z.literal(CompetitionDrawMode.MANUAL).optional(),
    avoidSameGroupFirstRound: z.literal(false).optional(),
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

const physicalScheduleFields = z
  .object({
    kickoffAt: z.string().datetime({ offset: true }).nullable(),
    venue: z.string().trim().min(1).max(150).nullable(),
  })
  .superRefine((schedule, context) => {
    if ((schedule.kickoffAt === null) !== (schedule.venue === null)) {
      context.addIssue({
        code: 'custom',
        message: 'kickoffAt and venue must both be set or both be null',
      });
    }
  });

const officialGroupFixtureSchema = z
  .object({
    officialNumber: z.number().int().min(1).max(42),
    groupKey: z.enum(['A', 'B']),
    homeEntryId: objectId,
    awayEntryId: objectId,
    kickoffAt: z.string().datetime({ offset: true }).nullable(),
    venue: z.string().trim().min(1).max(150).nullable(),
  })
  .strict()
  .superRefine((fixture, context) => {
    if ((fixture.kickoffAt === null) !== (fixture.venue === null)) {
      context.addIssue({
        code: 'custom',
        message: 'kickoffAt and venue must both be set or both be null',
      });
    }
  });

export const previewGroupFixturesSchema = z
  .object({
    expectedRevision,
    sourceReference: z.string().trim().min(1).max(200).optional(),
    fixtures: z.array(officialGroupFixtureSchema).length(42),
  })
  .strict();

export const publishGroupFixturesSchema = previewGroupFixturesSchema.extend({
  planHash: z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid fixture plan hash'),
});

const physicalDrawPairingSchema = z
  .object({
    slot: z.number().int().min(1).max(4),
    homeEntryId: objectId,
    awayEntryId: objectId,
    kickoffAt: physicalScheduleFields.shape.kickoffAt,
    venue: physicalScheduleFields.shape.venue,
  })
  .strict()
  .superRefine((pairing, context) => {
    if ((pairing.kickoffAt === null) !== (pairing.venue === null)) {
      context.addIssue({
        code: 'custom',
        message: 'kickoffAt and venue must both be set or both be null',
      });
    }
  });

export const createCompetitionDrawSchema = z
  .object({
    expectedRevision,
    sourceReference: z.string().trim().min(1).max(200).optional(),
    pairings: z.array(physicalDrawPairingSchema).length(4),
  })
  .strict();

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
