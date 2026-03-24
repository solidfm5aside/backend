import Payment from '@/models/payment.model';
import Team from '@/models/team.model';
import logger from '@/utils/logger';
import mongoose from 'mongoose';

export const recordPayment = async (paymentData: any) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await Payment.create([paymentData], { session });

    // If payment is completed, update team registration status
    if (paymentData.status === 'completed') {
      await Team.findByIdAndUpdate(
        paymentData.teamId,
        { registrationStatus: 'registered' },
        { session }
      );
      logger.info(`Team ${paymentData.teamId} registered via payment ${payment[0]._id}`);
    }

    await session.commitTransaction();
    return payment[0];
  } catch (error) {
    await session.abortTransaction();
    logger.error('Record Payment Error:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

export const getPayments = async (filter: any = {}) => {
  return await Payment.find(filter)
    .populate('teamId', 'name')
    .populate('tournamentId', 'name season')
    .sort({ createdAt: -1 });
};

export const updatePaymentStatus = async (paymentId: string, status: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await Payment.findByIdAndUpdate(
      paymentId,
      { status },
      { new: true, session }
    );

    if (payment && status === 'completed') {
      await Team.findByIdAndUpdate(
        payment.teamId,
        { registrationStatus: 'registered' },
        { session }
      );
    }

    await session.commitTransaction();
    return payment;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
