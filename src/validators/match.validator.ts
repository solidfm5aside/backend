import { z } from 'zod';
import { MatchStatus } from '@/models/match.model';

export const updateMatchStatusSchema = z.object({
  status: z.enum(['scheduled', 'live', 'completed', 'cancelled'] as [string, ...string[]]),
});

export const addMatchEventSchema = z.object({
  type: z.enum(['goal', 'yellow_card', 'red_card', 'substitution']),
  teamId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Team ID'),
  playerId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Player ID').optional(),
  assistPlayerId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Assist Player ID').optional(),
  minute: z.number().int().min(0).max(120),
  details: z.string().optional(),
});

export const updateMatchDetailsSchema = z.object({
  date: z.string().datetime().optional(),
  venue: z.string().optional(),
});

