import mongoose, { Document, Schema } from 'mongoose';

export enum TournamentEntryStatus {
  ACTIVE = 'active',
  WITHDRAWN = 'withdrawn',
}

export enum TournamentEntrySource {
  ADMIN = 'admin',
  PUBLIC_REGISTRATION = 'public_registration',
  LEGACY_IMPORT = 'legacy_import',
}

export interface ITournamentEntry extends Document {
  tournamentId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  status: TournamentEntryStatus;
  source: TournamentEntrySource;
  groupKey?: 'A' | 'B';
  groupSlot?: number;
  teamNameSnapshot: string;
  teamLogoSnapshot?: string;
  createdBy?: mongoose.Types.ObjectId;
  isDeleted: boolean;
}

const tournamentEntrySchema = new Schema<ITournamentEntry>(
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
    status: {
      type: String,
      enum: Object.values(TournamentEntryStatus),
      default: TournamentEntryStatus.ACTIVE,
    },
    source: {
      type: String,
      enum: Object.values(TournamentEntrySource),
      default: TournamentEntrySource.ADMIN,
    },
    groupKey: {
      type: String,
      enum: ['A', 'B'],
    },
    groupSlot: {
      type: Number,
      min: 1,
      max: 7,
    },
    teamNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    teamLogoSnapshot: String,
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

tournamentEntrySchema.index(
  { tournamentId: 1, teamId: 1 },
  {
    unique: true,
    name: 'one_active_team_entry_per_tournament',
    partialFilterExpression: { isDeleted: false, status: TournamentEntryStatus.ACTIVE },
  }
);

tournamentEntrySchema.index(
  { tournamentId: 1, groupKey: 1, groupSlot: 1 },
  {
    unique: true,
    name: 'one_team_per_group_slot',
    partialFilterExpression: {
      isDeleted: false,
      status: TournamentEntryStatus.ACTIVE,
      groupKey: { $type: 'string' },
      groupSlot: { $type: 'number' },
    },
  }
);

export default mongoose.model<ITournamentEntry>('TournamentEntry', tournamentEntrySchema);
