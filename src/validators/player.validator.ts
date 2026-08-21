import { z } from 'zod';
import { PlayerPosition } from '@/models/player.model';

const approvedPlayerPhotoUrl = z
  .string()
  .trim()
  .url('Invalid player photo URL')
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname.toLowerCase() === 'res.cloudinary.com';
    } catch {
      return false;
    }
  }, 'Player photo URL must use the approved HTTPS image host');

export const createPlayerSchema = z.object({
  name: z.string().trim().min(2, 'Player name is required').max(100),
  position: z.enum(Object.values(PlayerPosition) as [string, ...string[]]),
  jerseyNumber: z.preprocess(
    (value) => {
      if (typeof value === 'number') return value;
      if (typeof value !== 'string') return Number.NaN;

      const trimmed = value.trim();
      if (!trimmed) return undefined;

      return /^\d+$/.test(trimmed) ? trimmed : Number.NaN;
    },
    z.coerce.number().int().min(1).max(99)
  ),
  nationality: z.string().trim().min(2, 'Nationality is required').max(100),
  teamId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Team ID'),
  passportPic: approvedPlayerPhotoUrl.optional().or(z.literal('')),
});

export const updatePlayerSchema = createPlayerSchema.partial();
