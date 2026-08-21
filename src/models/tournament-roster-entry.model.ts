import mongoose, { Document, Schema } from 'mongoose';
import { PlayerPosition } from './player.model';

export interface ITournamentRosterEntry extends Document {
  tournamentId: mongoose.Types.ObjectId;
  tournamentEntryId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  playerId: mongoose.Types.ObjectId;
  playerNameSnapshot: string;
  positionSnapshot: PlayerPosition;
  jerseyNumberSnapshot: number;
  nationalitySnapshot: string;
  photoSnapshot?: string;
  publicationRevision: number;
  capturedAt: Date;
}

const tournamentRosterEntrySchema = new Schema<ITournamentRosterEntry>(
  {
    tournamentId: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true },
    tournamentEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'TournamentEntry',
      required: true,
    },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
    playerNameSnapshot: { type: String, required: true, trim: true },
    positionSnapshot: {
      type: String,
      enum: Object.values(PlayerPosition),
      required: true,
    },
    jerseyNumberSnapshot: { type: Number, min: 1, max: 99, required: true },
    nationalitySnapshot: { type: String, required: true, trim: true },
    photoSnapshot: { type: String, trim: true },
    publicationRevision: { type: Number, min: 0, required: true },
    capturedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

tournamentRosterEntrySchema.index(
  { tournamentId: 1, playerId: 1 },
  { unique: true, name: 'one_player_roster_entry_per_tournament' }
);
tournamentRosterEntrySchema.index({ tournamentId: 1, teamId: 1, playerId: 1 });
tournamentRosterEntrySchema.index({ playerId: 1, tournamentId: 1 });

export default mongoose.model<ITournamentRosterEntry>(
  'TournamentRosterEntry',
  tournamentRosterEntrySchema
);
