import { z } from 'zod';

export const updateMatchStatusSchema = z.object({
  status: z.enum(['scheduled', 'live', 'completed', 'cancelled'] as [string, ...string[]]),
});

export const addMatchEventSchema = z.object({
  type: z.enum(['goal', 'yellow_card', 'red_card', 'substitution']),
  teamId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Team ID'),
  playerId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Player ID'),
  assistPlayerId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Assist Player ID').optional(),
  minute: z.number().int().min(0).max(120),
  details: z.string().trim().max(500).optional(),
});

export const updateMatchDetailsSchema = z.object({
  date: z.string().datetime().optional(),
  venue: z.string().trim().min(1).max(150).optional(),
});

export const updateMatchWinnerSchema = z.object({
  winnerId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid winner ID'),
  isExtraTime: z.boolean().default(false),
  shootoutScore: z
    .object({
      home: z.number().int().min(0),
      away: z.number().int().min(0),
    })
    .optional(),
});

