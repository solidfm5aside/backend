import { Request, Response, NextFunction } from 'express';
import { sendBroadcast } from '@/services/broadcast.service';
import logger from '@/utils/logger';

/**
 * Controller for sending emergency and update broadcasts
 */
export const postBroadcast = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, subject } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Broadcast message cannot be empty'
      });
    }

    const result = await sendBroadcast(message, subject);

    res.status(200).json({
      success: true,
      message: `Broadcast successfully transmitted to ${result.recipientCount} team captains.`,
      recipientCount: result.recipientCount
    });
  } catch (error: any) {
    logger.error('Error in Broadcast Controller:', error);
    next(error);
  }
};
