import { z } from 'zod';
import { AdminRole } from '@/models/admin.model';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  bootstrapSecret: z.string().min(32).max(512).optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const adminRoleUpdateSchema = z
  .object({
    role: z.enum([AdminRole.VIEWER, AdminRole.ADMIN, AdminRole.SUPER_ADMIN]),
  })
  .strict();
