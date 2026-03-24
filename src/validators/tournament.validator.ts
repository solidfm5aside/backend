import { z } from 'zod';
import { TournamentStatus } from '@/models/tournament.model';

export const createTournamentSchema = z.object({
  name: z.string().min(3, 'Tournament name must be at least 3 characters'),
  season: z.string().min(1, 'Season is required'),
  startDate: z.string().transform((val) => new Date(val)),
  endDate: z.string().optional().transform((val) => val ? new Date(val) : undefined),
  status: z.enum(Object.values(TournamentStatus) as [string, ...string[]]).optional(),
});

export const updateTournamentSchema = createTournamentSchema.partial();
