import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import logger from '@/utils/logger';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = await schema.parseAsync(req.body);
      req.body = validatedData;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: error.issues.map((issue) => issue.message).join(', '),
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

export const validateObjectIdParam = (paramName = 'id', label = 'resource') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[paramName];

    if (typeof value !== 'string' || !OBJECT_ID_PATTERN.test(value)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${label} ID`,
      });
    }

    next();
  };
};
