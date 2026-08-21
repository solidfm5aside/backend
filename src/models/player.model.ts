import mongoose, { Schema, Document } from 'mongoose';

export enum PlayerPosition {
  GOALKEEPER = 'GK',
  DEFENDER = 'DF',
  MIDFIELDER = 'MF',
  FORWARD = 'FW',
}

export interface IPlayer extends Document {
  name: string;
  position: PlayerPosition;
  jerseyNumber: number;
  nationality: string;
  teamId: mongoose.Types.ObjectId;
  passportPic?: string;
  rosterSlot?: number;
  competitionRosterRevision: number;
  isDeleted: boolean;
}

const playerSchema = new Schema<IPlayer>(
  {
    name: {
      type: String,
      required: [true, 'Player name is required'],
      trim: true,
    },
    position: {
      type: String,
      enum: Object.values(PlayerPosition),
      required: [true, 'Position is required'],
    },
    jerseyNumber: {
      type: Number,
      required: [true, 'Jersey number is required'],
      min: [1, 'Jersey number must be between 1 and 99'],
      max: [99, 'Jersey number must be between 1 and 99'],
    },
    nationality: {
      type: String,
      required: [true, 'Nationality is required'],
      trim: true,
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: [true, 'Team reference is required'],
    },
    passportPic: {
      type: String,
    },
    rosterSlot: {
      type: Number,
      min: 1,
      max: 10,
      select: false,
    },
    competitionRosterRevision: {
      type: Number,
      min: 0,
      default: 0,
      select: false,
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

// Indexes
playerSchema.index({ teamId: 1 });
playerSchema.index({ name: 1 });
playerSchema.index(
  { teamId: 1, rosterSlot: 1 },
  {
    unique: true,
    name: 'one_active_player_per_roster_slot',
    partialFilterExpression: {
      isDeleted: false,
      rosterSlot: { $type: 'number' },
    },
  }
);

export default mongoose.model<IPlayer>('Player', playerSchema);
