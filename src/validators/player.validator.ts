import { z } from 'zod';
import { PlayerPosition } from '@/models/player.model';

export const createPlayerSchema = z.object({
  name: z.string().min(2, 'Player name is required'),
  position: z.enum(Object.values(PlayerPosition) as [string, ...string[]]),
  jerseyNumber: z.number().int().min(1).max(99),
  nationality: z.string().min(2, 'Nationality is required'),
  teamId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Team ID'),
});

export const updatePlayerSchema = createPlayerSchema.partial();
