import mongoose, { Document, Schema } from 'mongoose';

export enum WomensFinalStatus {
  PUBLISHED = 'published',
  CHAMPION_DECIDED = 'champion_decided',
}

export interface IWomensFinalQualifier {
  rank: 1 | 2;
  tournamentEntryId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
}

export interface IWomensCompetitionFinal extends Document {
  tournamentId: mongoose.Types.ObjectId;
  status: WomensFinalStatus;
  revision: number;
  qualificationRevision: number;
  qualifiers: IWomensFinalQualifier[];
  matchId: mongoose.Types.ObjectId;
  planHash: string;
  sourceReference?: string;
  publishedBy?: mongoose.Types.ObjectId;
  publishedAt: Date;
  championTeamId?: mongoose.Types.ObjectId;
  runnerUpTeamId?: mongoose.Types.ObjectId;
  championDecidedAt?: Date;
}

const qualifierSchema = new Schema<IWomensFinalQualifier>(
  {
    rank: { type: Number, enum: [1, 2], required: true },
    tournamentEntryId: {
      type: Schema.Types.ObjectId,
      ref: 'TournamentEntry',
      required: true,
    },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  },
  { _id: false }
);

const womensCompetitionFinalSchema = new Schema<IWomensCompetitionFinal>(
  {
    tournamentId: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true },
    status: {
      type: String,
      enum: Object.values(WomensFinalStatus),
      default: WomensFinalStatus.PUBLISHED,
      required: true,
    },
    revision: { type: Number, min: 0, required: true },
    qualificationRevision: { type: Number, min: 0, required: true },
    qualifiers: { type: [qualifierSchema], required: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    planHash: {
      type: String,
      required: true,
      match: /^[0-9a-f]{64}$/,
      lowercase: true,
    },
    sourceReference: { type: String, trim: true, maxlength: 200 },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    publishedAt: { type: Date, required: true },
    championTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    runnerUpTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    championDecidedAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true }
);

womensCompetitionFinalSchema.index(
  { tournamentId: 1 },
  { unique: true, name: 'one_womens_final_per_tournament' }
);

womensCompetitionFinalSchema.path('qualifiers').validate(
  (qualifiers: IWomensFinalQualifier[]) =>
    qualifiers.length === 2 &&
    new Set(qualifiers.map((qualifier) => qualifier.rank)).size === 2 &&
    new Set(qualifiers.map((qualifier) => qualifier.tournamentEntryId.toString())).size === 2 &&
    new Set(qualifiers.map((qualifier) => qualifier.teamId.toString())).size === 2,
  'A women’s final must snapshot distinct qualification ranks 1 and 2'
);

export default mongoose.model<IWomensCompetitionFinal>(
  'WomensCompetitionFinal',
  womensCompetitionFinalSchema
);
