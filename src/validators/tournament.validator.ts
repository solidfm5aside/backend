import { z } from 'zod';
import { TournamentFormat, TournamentStatus } from '@/models/tournament.model';

const dateString = z
  .string()
  .trim()
  .min(1, 'Date is required')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date')
  .transform((value) => new Date(value));

const tournamentFields = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Tournament name must be at least 3 characters')
    .max(120, 'Tournament name must be at most 120 characters'),
  season: z
    .string()
    .trim()
    .min(1, 'Season is required')
    .max(40, 'Season must be at most 40 characters'),
  startDate: dateString,
  endDate: dateString.nullable().optional(),
  status: z.enum(Object.values(TournamentStatus) as [string, ...string[]]).optional(),
  formatVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  format: z.enum(Object.values(TournamentFormat) as [string, ...string[]]).optional(),
});

const validateDateOrder = (
  value: { startDate?: Date; endDate?: Date | null },
  context: z.RefinementCtx
) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'End date cannot be before start date',
    });
  }
};

export const createTournamentSchema = tournamentFields
  .extend({
    formatVersion: z.literal(2),
    format: z.literal(TournamentFormat.TWO_GROUP_KNOCKOUT),
  })
  .superRefine(validateDateOrder);
export const updateTournamentSchema = tournamentFields.partial().superRefine(validateDateOrder);
