import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import logger from '@/utils/logger';

export const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: error.issues.map((e: any) => e.message).join(', '),
          details: error.issues,
          statusCode: 400,
          timestamp: new Date().toISOString(),
        });
      }
      logger.error('Unexpected Validation Error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error during validation',
        statusCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  };
};
