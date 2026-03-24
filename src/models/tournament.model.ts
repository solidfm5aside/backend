import mongoose, { Schema, Document } from 'mongoose';

export enum TournamentStatus {
  UPCOMING = 'upcoming',
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
}

export interface ITournament extends Document {
  name: string;
  season: string;
  startDate: Date;
  endDate?: Date;
  status: TournamentStatus;
  isDeleted: boolean;
}

const tournamentSchema = new Schema<ITournament>(
  {
    name: {
      type: String,
      required: [true, 'Tournament name is required'],
      trim: true,
    },
    season: {
      type: String,
      required: [true, 'Season is required'],
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: Object.values(TournamentStatus),
      default: TournamentStatus.UPCOMING,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<ITournament>('Tournament', tournamentSchema);
