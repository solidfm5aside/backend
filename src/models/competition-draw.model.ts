import mongoose, { Document, Schema } from 'mongoose';
import { CompetitionDrawMode } from './tournament.model';
import { MatchStage } from './match.model';

export enum CompetitionDrawType {
  GROUP_ASSIGNMENT = 'group_assignment',
  KNOCKOUT = 'knockout',
}

export enum CompetitionDrawStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  SUPERSEDED = 'superseded',
}

export interface IDrawInputEntry {
  tournamentEntryId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  groupKey: 'A' | 'B';
  groupRank: number;
}

export interface IDrawPairing {
  slot: number;
  homeEntryId: mongoose.Types.ObjectId;
  awayEntryId: mongoose.Types.ObjectId;
  homeTeamId: mongoose.Types.ObjectId;
  awayTeamId: mongoose.Types.ObjectId;
}

export interface ICompetitionDraw extends Document {
  tournamentId: mongoose.Types.ObjectId;
  type: CompetitionDrawType;
  stage: MatchStage;
  version: number;
  status: CompetitionDrawStatus;
  mode: CompetitionDrawMode;
  randomSeed?: string;
  inputSnapshot: IDrawInputEntry[];
  pairings: IDrawPairing[];
  rulesSnapshot: Record<string, unknown>;
  createdBy?: mongoose.Types.ObjectId;
  publishedBy?: mongoose.Types.ObjectId;
  publishedAt?: Date;
}

const drawInputEntrySchema = new Schema<IDrawInputEntry>(
  {
    tournamentEntryId: { type: Schema.Types.ObjectId, ref: 'TournamentEntry', required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    groupKey: { type: String, enum: ['A', 'B'], required: true },
    groupRank: { type: Number, min: 1, required: true },
  },
  { _id: false }
);

const drawPairingSchema = new Schema<IDrawPairing>(
  {
    slot: { type: Number, min: 1, required: true },
    homeEntryId: { type: Schema.Types.ObjectId, ref: 'TournamentEntry', required: true },
    awayEntryId: { type: Schema.Types.ObjectId, ref: 'TournamentEntry', required: true },
    homeTeamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    awayTeamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  },
  { _id: false }
);

const competitionDrawSchema = new Schema<ICompetitionDraw>(
  {
    tournamentId: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true },
    type: {
      type: String,
      enum: Object.values(CompetitionDrawType),
      default: CompetitionDrawType.KNOCKOUT,
    },
    stage: { type: String, enum: Object.values(MatchStage), required: true },
    version: { type: Number, min: 1, required: true },
    status: {
      type: String,
      enum: Object.values(CompetitionDrawStatus),
      default: CompetitionDrawStatus.DRAFT,
    },
    mode: { type: String, enum: Object.values(CompetitionDrawMode), required: true },
    randomSeed: String,
    inputSnapshot: { type: [drawInputEntrySchema], required: true },
    pairings: { type: [drawPairingSchema], required: true },
    rulesSnapshot: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    publishedAt: Date,
  },
  { timestamps: true }
);

competitionDrawSchema.index(
  { tournamentId: 1, type: 1, stage: 1, version: 1 },
  { unique: true, name: 'draw_version_unique' }
);
competitionDrawSchema.index(
  { tournamentId: 1, type: 1, stage: 1 },
  {
    unique: true,
    name: 'one_published_draw_per_stage',
    partialFilterExpression: { status: CompetitionDrawStatus.PUBLISHED },
  }
);

export default mongoose.model<ICompetitionDraw>('CompetitionDraw', competitionDrawSchema);
