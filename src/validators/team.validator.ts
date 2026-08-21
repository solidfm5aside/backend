import { z } from 'zod';

const approvedImageUrl = z
  .string()
  .trim()
  .url('Invalid logo URL')
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['res.cloudinary.com', 'ui-avatars.com'].includes(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  }, 'Logo URL must use an approved HTTPS image host');

const trimmedString = (fieldName: string, minimumLength = 2, maximumLength = 100) =>
  z
    .string()
    .trim()
    .min(minimumLength, `${fieldName} is required`)
    .max(maximumLength, `${fieldName} must not exceed ${maximumLength} characters`);

const optionalFoundedYear = z.preprocess(
  (value) => {
    if (value === undefined || typeof value === 'number') return value;
    if (typeof value !== 'string') return Number.NaN;

    const trimmed = value.trim();
    if (!trimmed) return undefined;

    return /^\d+$/.test(trimmed) ? trimmed : Number.NaN;
  },
  z.coerce
    .number()
    .int('Founded year must be a whole number')
    .min(1800)
    .max(new Date().getFullYear())
    .optional()
);

const colorsSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return trimmed.split(',').map((color) => color.trim());
}, z.array(z.string().trim().min(1).max(40)).max(10).optional());

const teamFields = {
  name: trimmedString('Team name', 3, 50),
  city: trimmedString('City', 2, 100),
  stadium: z.string().trim().max(150).optional(),
  colors: colorsSchema,
  logo: approvedImageUrl.optional().or(z.literal('')),
  foundedYear: optionalFoundedYear,
  captainName: trimmedString('Captain name', 2, 100),
  contactPhone: z
    .string()
    .trim()
    .min(7, 'Invalid phone number')
    .max(30, 'Contact phone must not exceed 30 characters'),
  contactEmail: z.string().trim().email('Invalid email address').max(254),
  registrationStatus: z.enum(['pending', 'registered', 'withdrawn']).optional(),
};

export const createTeamSchema = z.object(teamFields);

export const updateTeamSchema = createTeamSchema
  .partial()
  .strict()
  .refine((updates) => Object.keys(updates).length > 0, {
    message: 'At least one team field is required',
  });

export const registerTeamSchema = z.object({
  name: teamFields.name,
  city: teamFields.city,
  captainName: teamFields.captainName,
  contactPhone: teamFields.contactPhone,
  contactEmail: teamFields.contactEmail,
  logo: teamFields.logo,
});
