import { Request, Response, NextFunction } from 'express';
import { sendBroadcast } from '@/services/broadcast.service';
import logger from '@/utils/logger';

/**
 * Controller for sending emergency and update broadcasts
 */
export const postBroadcast = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, subject } = req.body;

    if (typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Broadcast message cannot be empty'
      });
    }

    if (message.trim().length > 10_000) {
      return res.status(400).json({ success: false, message: 'Broadcast message is too long' });
    }
    if (subject !== undefined && (typeof subject !== 'string' || subject.trim().length > 200)) {
      return res.status(400).json({ success: false, message: 'Broadcast subject is invalid' });
    }

    const result = await sendBroadcast(message.trim(), subject?.trim());

    res.status(200).json({
      success: true,
      message: `Broadcast successfully transmitted to ${result.recipientCount} team captains.`,
      recipientCount: result.recipientCount
    });
  } catch (error: unknown) {
    logger.error('Error in Broadcast Controller:', error);
    next(error);
  }
};
