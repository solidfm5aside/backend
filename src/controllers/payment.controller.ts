import { Request, Response } from 'express';
import * as paymentService from '@/services/payment.service';
import logger from '@/utils/logger';

export const recordPayment = async (req: Request, res: Response) => {
  try {
    const payment = await paymentService.recordPayment(req.body);
    res.status(201).json({ success: true, data: payment, message: 'Payment recorded successfully' });
  } catch (error: any) {
    logger.error('Record Payment Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to record payment' });
  }
};

export const getPayments = async (req: Request, res: Response) => {
  try {
    const { teamId, tournamentId } = req.query;
    const filter: any = {};
    if (teamId) filter.teamId = teamId;
    if (tournamentId) filter.tournamentId = tournamentId;

    const payments = await paymentService.getPayments(filter);
    res.status(200).json({ success: true, data: payments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch payments' });
  }
};

export const updateStatus = async (req: Request, res: Response) => {
  try {
    const payment = await paymentService.updatePaymentStatus(req.params.id as string, req.body.status);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.status(200).json({ success: true, data: payment, message: `Payment status updated to ${req.body.status}` });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to update payment status' });
  }
};
