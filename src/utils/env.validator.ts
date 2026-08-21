import { z } from 'zod';
import logger from './logger';
import { parseClientOrigins, parseHttpOrigin } from './client-origin.util';

const mongoConnectionString = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      (value.startsWith('mongodb://') || value.startsWith('mongodb+srv://')) &&
      !/\s/.test(value),
    'MONGODB_URI must be a valid MongoDB connection string'
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('5000'),
  MONGODB_URI: mongoConnectionString,
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  CLIENT_URL: z.string().superRefine((value, context) => {
    try {
      parseClientOrigins(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'CLIENT_URL is invalid',
      });
    }
  }),
  FRONTEND_URL: z.string().superRefine((value, context) => {
    try {
      parseHttpOrigin(value, 'FRONTEND_URL');
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'FRONTEND_URL is invalid',
      });
    }
  }).optional(),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).optional(),
  ADMIN_BOOTSTRAP_SECRET: z.string().min(32).max(512).optional(),
  CLOUDINARY_URL: z.string().url(),
});

export const validateEnv = () => {
  try {
    envSchema.parse(process.env);
    logger.info('Environment variables validated successfully');
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.issues.map(err => err.path.join('.')).join(', ');
      logger.error(`Environment validation failed. Missing or invalid variables: ${missingVars}`);
      process.exit(1);
    }
  }
};
