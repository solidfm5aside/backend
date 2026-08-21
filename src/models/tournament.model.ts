import mongoose, { Schema, Document } from 'mongoose';
import { MatchStage } from './match.model';

export enum TournamentStatus {
  UPCOMING = 'upcoming',
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
}

export enum TournamentFormat {
  LEGACY_LEAGUE = 'legacy_league',
  TWO_GROUP_KNOCKOUT = 'two_group_knockout',
}

export enum CompetitionWorkflowState {
  SETUP = 'setup',
  ENTRIES_READY = 'entries_ready',
  GROUPS_ASSIGNED = 'groups_assigned',
  GROUP_FIXTURES_PUBLISHED = 'group_fixtures_published',
  GROUP_STAGE = 'group_stage',
  QUALIFICATION_FINALIZED = 'qualification_finalized',
  KNOCKOUT_DRAW_PUBLISHED = 'knockout_draw_published',
  KNOCKOUT_STAGE = 'knockout_stage',
  COMPLETED = 'completed',
}

export enum CompetitionTieBreaker {
  POINTS = 'points',
  GOAL_DIFFERENCE = 'goal_difference',
  GOALS_FOR = 'goals_for',
  HEAD_TO_HEAD = 'head_to_head',
  COMMITTEE_DECISION = 'committee_decision',
}

export enum CompetitionDrawMode {
  MANUAL = 'manual',
  RANDOM = 'random',
  SEEDED_CROSS_GROUP = 'seeded_cross_group',
}

export enum CompetitionCommitteeDecisionMethod {
  COIN_TOSS = 'coin_toss',
  DRAW = 'draw',
  OTHER = 'other',
}

export enum CompetitionTieResolutionStatus {
  ACTIVE = 'active',
  SUPERSEDED = 'superseded',
}

export interface ICompetitionRules {
  teamCount: number;
  groupCount: number;
  teamsPerGroup: number;
  roundRobinLegs: 1 | 2 | null;
  qualifiersPerGroup: number | null;
  tieBreakers: CompetitionTieBreaker[];
  drawMode: CompetitionDrawMode | null;
  avoidSameGroupFirstRound: boolean | null;
  thirdPlaceMatch: boolean | null;
  maxRosterPlayers: number;
}

export const FIXED_V2_COMPETITION_RULES: Readonly<ICompetitionRules> = Object.freeze({
  teamCount: 14,
  groupCount: 2,
  teamsPerGroup: 7,
  roundRobinLegs: 1,
  qualifiersPerGroup: 4,
  tieBreakers: Object.freeze([
    CompetitionTieBreaker.POINTS,
    CompetitionTieBreaker.GOAL_DIFFERENCE,
    CompetitionTieBreaker.GOALS_FOR,
    CompetitionTieBreaker.HEAD_TO_HEAD,
    CompetitionTieBreaker.COMMITTEE_DECISION,
  ]) as unknown as CompetitionTieBreaker[],
  drawMode: CompetitionDrawMode.SEEDED_CROSS_GROUP,
  avoidSameGroupFirstRound: true,
  thirdPlaceMatch: false,
  maxRosterPlayers: 10,
});

export interface ICompetitionTieResolution {
  decisionId: mongoose.Types.ObjectId;
  decisionRevision: number;
  status: CompetitionTieResolutionStatus;
  groupKey: 'A' | 'B';
  basisHash: string;
  tiedTeamIds: mongoose.Types.ObjectId[];
  orderedTeamIds: mongoose.Types.ObjectId[];
  method: CompetitionCommitteeDecisionMethod;
  note?: string;
  decidedBy?: mongoose.Types.ObjectId;
  decidedAt: Date;
  supersededAt?: Date;
  supersededByDecisionId?: mongoose.Types.ObjectId;
}

export interface IQualifiedEntrySnapshot {
  tournamentEntryId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  groupKey: 'A' | 'B';
  rank: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
}

export interface ITournament extends Document {
  name: string;
  season: string;
  startDate: Date;
  endDate?: Date;
  status: TournamentStatus;
  currentStage: MatchStage; 
  leagueRounds: number;
  fixturesGenerated: boolean;
  formatVersion: 1 | 2;
  format: TournamentFormat;
  workflowState: CompetitionWorkflowState;
  workflowRevision: number;
  entryIdentityRevision: number;
  rosterIdentityRevision: number;
  standingsRevision: number;
  competitionRules?: ICompetitionRules;
  competitionTieResolutions: ICompetitionTieResolution[];
  qualificationSnapshot: IQualifiedEntrySnapshot[];
  qualificationFinalizedAt?: Date;
  championTeamId?: mongoose.Types.ObjectId;
  runnerUpTeamId?: mongoose.Types.ObjectId;
  thirdPlaceTeamId?: mongoose.Types.ObjectId;
  competitionCompletedAt?: Date;
  isDeleted: boolean;
}

const competitionRulesSchema = new Schema<ICompetitionRules>(
  {
    teamCount: { type: Number, required: true, default: 14, immutable: true },
    groupCount: { type: Number, required: true, default: 2, immutable: true },
    teamsPerGroup: { type: Number, required: true, default: 7, immutable: true },
    roundRobinLegs: { type: Number, enum: [1, 2, null], default: 1 },
    qualifiersPerGroup: { type: Number, min: 1, max: 7, default: 4 },
    tieBreakers: {
      type: [String],
      enum: Object.values(CompetitionTieBreaker),
      default: () => [...FIXED_V2_COMPETITION_RULES.tieBreakers],
    },
    drawMode: {
      type: String,
      enum: [...Object.values(CompetitionDrawMode), null],
      default: CompetitionDrawMode.SEEDED_CROSS_GROUP,
    },
    avoidSameGroupFirstRound: { type: Boolean, default: true },
    thirdPlaceMatch: { type: Boolean, default: false },
    maxRosterPlayers: { type: Number, min: 1, max: 100, default: 10 },
  },
  { _id: false }
);

const competitionTieResolutionSchema = new Schema<ICompetitionTieResolution>(
  {
    decisionId: {
      type: Schema.Types.ObjectId,
      required: true,
      default: () => new mongoose.Types.ObjectId(),
    },
    decisionRevision: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: Object.values(CompetitionTieResolutionStatus),
      required: true,
      default: CompetitionTieResolutionStatus.ACTIVE,
    },
    groupKey: { type: String, enum: ['A', 'B'], required: true },
    basisHash: {
      type: String,
      required: true,
      match: /^[0-9a-f]{64}$/,
      lowercase: true,
    },
    tiedTeamIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Team', required: true }],
      required: true,
    },
    orderedTeamIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Team', required: true }],
      required: true,
    },
    method: {
      type: String,
      enum: Object.values(CompetitionCommitteeDecisionMethod),
      required: true,
    },
    note: { type: String, trim: true, maxlength: 500 },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    decidedAt: { type: Date, required: true },
    supersededAt: Date,
    supersededByDecisionId: { type: Schema.Types.ObjectId },
  },
  { _id: false }
);

const qualifiedEntrySnapshotSchema = new Schema<IQualifiedEntrySnapshot>(
  {
    tournamentEntryId: { type: Schema.Types.ObjectId, ref: 'TournamentEntry', required: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    groupKey: { type: String, enum: ['A', 'B'], required: true },
    rank: { type: Number, required: true, min: 1 },
    points: { type: Number, required: true },
    goalDifference: { type: Number, required: true },
    goalsFor: { type: Number, required: true },
  },
  { _id: false }
);

const tournamentSchema = new Schema<ITournament>(
  {
    name: {
      type: String,
      required: [true, 'Tournament name is required'],
      trim: true,
      maxlength: 120,
    },
    season: {
      type: String,
      required: [true, 'Season is required'],
      trim: true,
      maxlength: 40,
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
    },
    currentStage: {
      type: String,
      enum: Object.values(MatchStage),
      default: MatchStage.LEAGUE,
    },
    leagueRounds: {
      type: Number,
      default: 6,
    },
    status: {
      type: String,
      enum: Object.values(TournamentStatus),
      default: TournamentStatus.UPCOMING,
    },
    fixturesGenerated: {
      type: Boolean,
      default: false,
    },
    formatVersion: {
      type: Number,
      enum: [1, 2],
      default: 1,
    },
    format: {
      type: String,
      enum: Object.values(TournamentFormat),
      default: TournamentFormat.LEGACY_LEAGUE,
    },
    workflowState: {
      type: String,
      enum: Object.values(CompetitionWorkflowState),
      default: CompetitionWorkflowState.SETUP,
    },
    workflowRevision: {
      type: Number,
      min: 0,
      default: 0,
    },
    entryIdentityRevision: {
      type: Number,
      min: 0,
      default: 0,
    },
    rosterIdentityRevision: {
      type: Number,
      min: 0,
      default: 0,
      select: false,
    },
    standingsRevision: {
      type: Number,
      min: 0,
      default: 0,
    },
    competitionRules: {
      type: competitionRulesSchema,
      default: undefined,
    },
    competitionTieResolutions: {
      type: [competitionTieResolutionSchema],
      default: [],
    },
    qualificationSnapshot: {
      type: [qualifiedEntrySnapshotSchema],
      default: [],
    },
    qualificationFinalizedAt: Date,
    championTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    runnerUpTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    thirdPlaceTeamId: { type: Schema.Types.ObjectId, ref: 'Team' },
    competitionCompletedAt: Date,

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

tournamentSchema.index({ formatVersion: 1, workflowState: 1 });

tournamentSchema.path('competitionTieResolutions').validate(
  (resolutions: ICompetitionTieResolution[]) => {
    const activeKeys = resolutions
      .filter(
        (resolution) =>
          !resolution.status || resolution.status === CompetitionTieResolutionStatus.ACTIVE
      )
      .map((resolution) => `${resolution.groupKey}:${resolution.basisHash}`);
    return new Set(activeKeys).size === activeKeys.length;
  },
  'Only one active committee decision is allowed for each tie basis'
);

export default mongoose.model<ITournament>('Tournament', tournamentSchema);
