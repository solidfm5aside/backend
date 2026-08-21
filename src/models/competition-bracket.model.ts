import mongoose, { Document, Schema } from 'mongoose';
import { MatchStage } from './match.model';

export enum CompetitionBracketStatus {
  ACTIVE = 'active',
  CHAMPION_DECIDED = 'champion_decided',
}

export enum CompetitionBracketNodeKind {
  CHAMPIONSHIP = 'championship',
  THIRD_PLACE = 'third_place',
}

export enum CompetitionBracketSourceType {
  DRAW_PAIRING = 'draw_pairing',
  WINNER = 'winner',
  LOSER = 'loser',
}

export interface ICompetitionBracketSource {
  type: CompetitionBracketSourceType;
  drawPairingSlot?: number;
  drawSide?: 'home' | 'away';
  sourceNodeKey?: string;
}

export interface ICompetitionBracketNode {
  key: string;
  stage: MatchStage;
  slot: number;
  kind: CompetitionBracketNodeKind;
  homeSource: ICompetitionBracketSource;
  awaySource: ICompetitionBracketSource;
  homeTeamId?: mongoose.Types.ObjectId;
  awayTeamId?: mongoose.Types.ObjectId;
  matchId?: mongoose.Types.ObjectId;
  winnerTeamId?: mongoose.Types.ObjectId;
  loserTeamId?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
}

export interface ICompetitionBracket extends Document {
  tournamentId: mongoose.Types.ObjectId;
  sourceDrawId: mongoose.Types.ObjectId;
  entrantCount: number;
  status: CompetitionBracketStatus;
  revision: number;
  nodes: ICompetitionBracketNode[];
  championTeamId?: mongoose.Types.ObjectId;
  runnerUpTeamId?: mongoose.Types.ObjectId;
  thirdPlaceTeamId?: mongoose.Types.ObjectId;
  championDecidedAt?: Date;
  thirdPlaceDecidedAt?: Date;
}

const bracketSourceSchema = new Schema<ICompetitionBracketSource>(
  {
    type: {
      type: String,
      enum: Object.values(CompetitionBracketSourceType),
      required: true,
    },
    drawPairingSlot: { type: Number, min: 1 },
    drawSide: { type: String, enum: ['home', 'away'] },
    sourceNodeKey: { type: String, trim: true },
  },
  { _id: false }
);

const bracketNodeSchema = new Schema<ICompetitionBracketNode>(
  {
    key: { type: String, required: true, trim: true },
    stage: { type: String, enum: Object.values(MatchStage), required: true },
    slot: { type: Number, min: 1, required: true },
    kind: {
      type: String,
      enum: Object.values(CompetitionBracketNodeKind),
      required: true,
    },
    homeSource: { type: bracketSourceSchema, required: true },
    awaySource: { type: bracketSourceSchema, required: true },
    homeTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    awayTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match' },
    winnerTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    loserTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    resolvedAt: Date,
  },
  { _id: false }
);

const competitionBracketSchema = new Schema<ICompetitionBracket>(
  {
    tournamentId: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true },
    sourceDrawId: { type: Schema.Types.ObjectId, ref: 'CompetitionDraw', required: true },
    entrantCount: { type: Number, enum: [2, 4, 8, 16], required: true },
    status: {
      type: String,
      enum: Object.values(CompetitionBracketStatus),
      default: CompetitionBracketStatus.ACTIVE,
    },
    revision: { type: Number, min: 0, required: true },
    nodes: { type: [bracketNodeSchema], required: true },
    championTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    runnerUpTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    thirdPlaceTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    championDecidedAt: Date,
    thirdPlaceDecidedAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true }
);

competitionBracketSchema.index(
  { tournamentId: 1 },
  { unique: true, name: 'one_competition_bracket_per_tournament' }
);
competitionBracketSchema.index(
  { sourceDrawId: 1 },
  { unique: true, name: 'one_competition_bracket_per_draw' }
);

competitionBracketSchema.path('nodes').validate(
  (nodes: ICompetitionBracketNode[]) => new Set(nodes.map((node) => node.key)).size === nodes.length,
  'Bracket node keys must be unique'
);

export default mongoose.model<ICompetitionBracket>(
  'CompetitionBracket',
  competitionBracketSchema
);
