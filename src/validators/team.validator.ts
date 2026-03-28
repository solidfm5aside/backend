import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(3, 'Team name must be at least 3 characters').max(50),
  city: z.string().min(2, 'City is required'),
  stadium: z.string().optional(),
  colors: z.array(z.string()).optional(),
  logo: z.string().url('Invalid logo URL').optional().or(z.literal('')),
  foundedYear: z.number().int().min(1800).max(new Date().getFullYear()).optional(),
});

export const updateTeamSchema = createTeamSchema.partial();

export const registerTeamSchema = z.object({
  name: z.string().min(3, 'Team name must be at least 3 characters').max(50),
  city: z.string().min(2, 'City is required'),
  captainName: z.string().min(2, 'Captain name is required'),
  contactPhone: z.string().min(7, 'Invalid phone number'),
  contactEmail: z.string().email('Invalid email address'),
  logo: z.string().optional(),
});
