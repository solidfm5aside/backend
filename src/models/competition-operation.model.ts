import mongoose, { Document, Schema } from 'mongoose';

export enum CompetitionOperationStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}

export interface ICompetitionOperation extends Document {
  tournamentId: mongoose.Types.ObjectId;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  status: CompetitionOperationStatus;
  result?: unknown;
}

const competitionOperationSchema = new Schema<ICompetitionOperation>(
  {
    tournamentId: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true },
    operation: { type: String, required: true, trim: true },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 200 },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(CompetitionOperationStatus),
      default: CompetitionOperationStatus.PENDING,
    },
    result: Schema.Types.Mixed,
  },
  { timestamps: true }
);

competitionOperationSchema.index(
  { tournamentId: 1, operation: 1, idempotencyKey: 1 },
  { unique: true, name: 'competition_operation_idempotency' }
);

export default mongoose.model<ICompetitionOperation>(
  'CompetitionOperation',
  competitionOperationSchema
);
