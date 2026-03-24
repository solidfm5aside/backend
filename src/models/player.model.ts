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
    },
    nationality: {
      type: String,
      required: [true, 'Nationality is required'],
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: [true, 'Team reference is required'],
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

export default mongoose.model<IPlayer>('Player', playerSchema);
