import mongoose, { Schema, Document } from 'mongoose';

export interface IPlayerStats extends Document {
  tournamentId: mongoose.Types.ObjectId;
  playerId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  matchesPlayed: number;
}

const playerStatsSchema = new Schema<IPlayerStats>(
  {
    tournamentId: {
      type: Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
    },
    playerId: {
      type: Schema.Types.ObjectId,
      ref: 'Player',
      required: true,
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    goals: { type: Number, default: 0 },
    assists: { type: Number, default: 0 },
    yellowCards: { type: Number, default: 0 },
    redCards: { type: Number, default: 0 },
    matchesPlayed: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

// Indexes for fast querying
playerStatsSchema.index({ tournamentId: 1, goals: -1 });
playerStatsSchema.index({ tournamentId: 1, playerId: 1 }, { unique: true });

export default mongoose.model<IPlayerStats>('PlayerStats', playerStatsSchema);
