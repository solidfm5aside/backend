import { z } from 'zod';

export const createPaymentSchema = z.object({
  tournamentId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Tournament ID'),
  teamId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid Team ID'),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().default('NGN'),
  status: z.enum(['pending', 'completed', 'failed', 'refunded']).default('completed'),
  paymentMethod: z.string().min(2, 'Payment method is required'),
  transactionReference: z.string().min(3, 'Reference is required'),
});
