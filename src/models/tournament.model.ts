import mongoose, { Schema, Document } from 'mongoose';
import { MatchStage } from './match.model';

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
  currentStage: MatchStage; 
  leagueRounds: number;
  fixturesGenerated: boolean;
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
    currentStage: {
      type: String,
      enum: Object.values(MatchStage),
      default: MatchStage.LEAGUE,
    },
    leagueRounds: {
      type: Number,
      default: 6,
    },
    status: {
      type: String,
      enum: Object.values(TournamentStatus),
      default: TournamentStatus.UPCOMING,
    },
    fixturesGenerated: {
      type: Boolean,
      default: false,
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
