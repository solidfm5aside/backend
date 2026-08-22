import { z } from 'zod';
import { CompetitionCommitteeDecisionMethod } from '@/models/tournament.model';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
const expectedRevision = z.number().int().min(0);
const planHash = z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid fixture plan hash');

const scheduleFields = {
  kickoffAt: z.string().datetime({ offset: true }).nullable(),
  venue: z.string().trim().min(1).max(150).nullable(),
};

const validatePairedSchedule = (
  value: { kickoffAt: string | null; venue: string | null },
  context: z.RefinementCtx
) => {
  if ((value.kickoffAt === null) !== (value.venue === null)) {
    context.addIssue({
      code: 'custom',
      message: 'kickoffAt and venue must both be set or both be null',
    });
  }
};

const leagueFixtureSchema = z
  .object({
    officialNumber: z.number().int().min(1).max(3),
    homeEntryId: objectId,
    awayEntryId: objectId,
    ...scheduleFields,
  })
  .strict()
  .superRefine(validatePairedSchedule);

export const previewWomensLeagueFixturesSchema = z
  .object({
    expectedRevision,
    sourceReference: z.string().trim().min(1).max(200).optional(),
    fixtures: z.array(leagueFixtureSchema).length(3),
  })
  .strict();

export const publishWomensLeagueFixturesSchema = previewWomensLeagueFixturesSchema.extend({
  planHash,
});

export const previewWomensFinalSchema = z
  .object({
    expectedRevision,
    sourceReference: z.string().trim().min(1).max(200).optional(),
    ...scheduleFields,
  })
  .strict()
  .superRefine(validatePairedSchedule);

export const publishWomensFinalSchema = previewWomensFinalSchema.extend({ planHash });

export const resolveWomensTableTieSchema = z
  .object({
    expectedRevision,
    basisHash: z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid tie basis hash'),
    orderedTeamIds: z
      .array(objectId)
      .min(2)
      .max(3)
      .refine(
        (teamIds) => new Set(teamIds).size === teamIds.length,
        'Committee order cannot contain a team more than once'
      ),
    method: z.enum(CompetitionCommitteeDecisionMethod),
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
