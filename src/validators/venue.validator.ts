import { z } from 'zod';

export const createVenueSchema = z.object({
  name: z.string().min(2, 'Venue name must be at least 2 characters'),
  address: z.string().min(5, 'Address must be at least 5 characters'),
  importance: z.number().min(1, 'Importance must be at least 1').optional(),
});

export const updateVenueSchema = z.object({
  name: z.string().min(2, 'Venue name must be at least 2 characters').optional(),
  address: z.string().min(5, 'Address must be at least 5 characters').optional(),
  importance: z.number().min(1, 'Importance must be at least 1').optional(),
});
