import mongoose, { Schema, Document } from 'mongoose';

export interface IStandings extends Document {
  tournamentId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  tournamentEntryId?: mongoose.Types.ObjectId;
  groupKey?: 'A' | 'B';
  rank?: number;
  revision: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  fairPlayPoints: number;
}

const standingsSchema = new Schema<IStandings>(
  {
    tournamentId: {
      type: Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    tournamentEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'TournamentEntry',
    },
    groupKey: {
      type: String,
      enum: ['A', 'B'],
    },
    rank: { type: Number, min: 1 },
    revision: { type: Number, min: 0, default: 0 },
    played: { type: Number, default: 0 },
    won: { type: Number, default: 0 },
    drawn: { type: Number, default: 0 },
    lost: { type: Number, default: 0 },
    goalsFor: { type: Number, default: 0 },
    goalsAgainst: { type: Number, default: 0 },
    goalDifference: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    fairPlayPoints: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

// Indexes
standingsSchema.index({ tournamentId: 1, points: -1, goalDifference: -1, goalsFor: -1 });
standingsSchema.index(
  { tournamentId: 1, teamId: 1 },
  { unique: true, name: 'one_standing_per_tournament_team' }
);
standingsSchema.index({ tournamentId: 1, groupKey: 1, rank: 1 });

export default mongoose.model<IStandings>('Standings', standingsSchema);
