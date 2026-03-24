import mongoose, { Schema, Document } from 'mongoose';

export enum PaymentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

export interface IPayment extends Document {
  teamId: mongoose.Types.ObjectId;
  tournamentId: mongoose.Types.ObjectId;
  amount: number;
  status: PaymentStatus;
  date: Date;
  reference?: string;
  receiptUrl?: string;
  isDeleted: boolean;
}

const paymentSchema = new Schema<IPayment>(
  {
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    tournamentId: {
      type: Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    reference: String,
    receiptUrl: String,
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IPayment>('Payment', paymentSchema);
