import mongoose, { Schema, Document } from 'mongoose';

export enum MatchStatus {
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum MatchEventType {
  GOAL = 'goal',
  YELLOW_CARD = 'yellow_card',
  RED_CARD = 'red_card',
  SUBSTITUTION = 'substitution',
}

export interface IMatchEvent {
  type: MatchEventType;
  minute: number;
  playerId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  details?: string;
}

export interface IMatch extends Document {
  tournamentId: mongoose.Types.ObjectId;
  homeTeam: mongoose.Types.ObjectId;
  awayTeam: mongoose.Types.ObjectId;
  homeScore: number;
  awayScore: number;
  date: Date;
  status: MatchStatus;
  venue?: string;
  referee?: string;
  events: IMatchEvent[];
  isDeleted: boolean;
}

const matchEventSchema = new Schema<IMatchEvent>(
  {
    type: {
      type: String,
      enum: Object.values(MatchEventType),
      required: true,
    },
    minute: {
      type: Number,
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
    details: String,
  },
  { _id: false }
);

const matchSchema = new Schema<IMatch>(
  {
    tournamentId: {
      type: Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
    },
    homeTeam: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    awayTeam: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    homeScore: {
      type: Number,
      default: 0,
    },
    awayScore: {
      type: Number,
      default: 0,
    },
    date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(MatchStatus),
      default: MatchStatus.SCHEDULED,
    },
    venue: String,
    referee: String,
    events: [matchEventSchema],
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
matchSchema.index({ tournamentId: 1, date: 1 });
matchSchema.index({ homeTeam: 1 });
matchSchema.index({ awayTeam: 1 });

export default mongoose.model<IMatch>('Match', matchSchema);
