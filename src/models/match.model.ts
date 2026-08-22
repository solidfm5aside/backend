import mongoose, { Schema, Document } from 'mongoose';

export enum MatchStatus {
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum MatchScheduleStatus {
  CONFIRMED = 'confirmed',
  PENDING = 'pending',
}

export enum MatchFixtureSource {
  SYSTEM_LEGACY = 'system_legacy',
  PHYSICAL_OFFICIAL = 'physical_official',
}

export enum MatchEventType {
  GOAL = 'goal',
  YELLOW_CARD = 'yellow_card',
  RED_CARD = 'red_card',
  SUBSTITUTION = 'substitution',
}

export interface IMatchEvent {
  _id?: mongoose.Types.ObjectId;
  type: MatchEventType;
  minute: number;
  playerId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  details?: string;
  assistPlayerId?: mongoose.Types.ObjectId;
  operationKey?: string;
}


export enum MatchStage {
  LEAGUE = 'league',
  GROUP_STAGE = 'group_stage',
  PLAYOFF = 'playoff',
  ROUND_OF_16 = 'round_of_16',
  QUARTER_FINALS = 'quarter_finals',
  SEMI_FINALS = 'semi_finals',
  FINAL = 'final',
  THIRD_PLACE = 'third_place',
}

export interface IMatch extends Document {
  tournamentId: mongoose.Types.ObjectId;
  homeTeam: mongoose.Types.ObjectId;
  awayTeam: mongoose.Types.ObjectId;
  homeScore: number;
  awayScore: number;
  date?: Date;
  status: MatchStatus;
  stage: MatchStage;
  round?: number;
  groupKey?: 'A' | 'B';
  leg?: number;
  fixtureKey?: string;
  officialFixtureNumber?: number;
  scheduleStatus: MatchScheduleStatus;
  fixtureSource?: MatchFixtureSource;
  fixturePublicationHash?: string;
  fixtureSourceReference?: string;
  fixturePublishedBy?: mongoose.Types.ObjectId;
  fixturePublishedAt?: Date;
  drawId?: mongoose.Types.ObjectId;
  bracketId?: mongoose.Types.ObjectId;
  bracketNodeKey?: string;
  bracketSlot?: number;
  womensFinalId?: mongoose.Types.ObjectId;
  venue?: string;
  referee?: string;
  events: IMatchEvent[];
  isDeleted: boolean;
  // Knockout fields
  isExtraTime?: boolean;     // true if the match required extra time
  winner?: mongoose.Types.ObjectId; // the team that advances (source of truth)
  shootoutScore?: { home: number; away: number }; // set only if pens were needed
  resultLockedAt?: Date;
  resultLockReason?: string;
  deletedEventIds?: mongoose.Types.ObjectId[];
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
    assistPlayerId: {
      type: Schema.Types.ObjectId,
      ref: 'Player',
    },
    operationKey: {
      type: String,
      maxlength: 64,
      select: false,
    },
  },
  { _id: true }
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
    },
    scheduleStatus: {
      type: String,
      enum: Object.values(MatchScheduleStatus),
      default: MatchScheduleStatus.CONFIRMED,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(MatchStatus),
      default: MatchStatus.SCHEDULED,
    },
    stage: {
      type: String,
      enum: Object.values(MatchStage),
      default: MatchStage.LEAGUE,
    },
    round: Number,
    groupKey: {
      type: String,
      enum: ['A', 'B'],
    },
    leg: {
      type: Number,
      min: 1,
      max: 2,
    },
    fixtureKey: {
      type: String,
      trim: true,
    },
    officialFixtureNumber: {
      type: Number,
      min: 1,
    },
    fixtureSource: {
      type: String,
      enum: Object.values(MatchFixtureSource),
    },
    fixturePublicationHash: {
      type: String,
      match: /^[0-9a-f]{64}$/,
      lowercase: true,
    },
    fixtureSourceReference: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    fixturePublishedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
    },
    fixturePublishedAt: Date,
    drawId: {
      type: Schema.Types.ObjectId,
      ref: 'CompetitionDraw',
    },
    bracketId: {
      type: Schema.Types.ObjectId,
      ref: 'CompetitionBracket',
    },
    bracketNodeKey: {
      type: String,
      trim: true,
    },
    bracketSlot: {
      type: Number,
      min: 1,
    },
    womensFinalId: {
      type: Schema.Types.ObjectId,
      ref: 'WomensCompetitionFinal',
    },
    venue: String,
    referee: String,
    events: [matchEventSchema],
    // Knockout resolution fields
    isExtraTime: {
      type: Boolean,
      default: false,
    },
    winner: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
    },
    shootoutScore: {
      home: { type: Number },
      away: { type: Number },
    },
    resultLockedAt: Date,
    resultLockReason: {
      type: String,
      trim: true,
    },
    // Durable tombstones let DELETE remain retry-safe without treating a
    // never-existing event id as a successful deletion. Hidden from every
    // ordinary match response because this is internal mutation metadata.
    deletedEventIds: {
      type: [Schema.Types.ObjectId],
      default: undefined,
      select: false,
    },
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

matchSchema.pre('validate', function validatePhysicalFixtureMetadata() {
  if (this.fixtureSource !== MatchFixtureSource.PHYSICAL_OFFICIAL) return;
  const hasDate = this.date instanceof Date;
  const hasVenue = Boolean(this.venue?.trim());
  const expectedScheduleStatus = hasDate
    ? MatchScheduleStatus.CONFIRMED
    : MatchScheduleStatus.PENDING;
  if (
    hasDate !== hasVenue ||
    this.scheduleStatus !== expectedScheduleStatus ||
    !this.officialFixtureNumber ||
    !this.fixturePublicationHash
  ) {
    throw new Error(
      'A physical official fixture requires valid publication metadata and a fully confirmed or fully pending schedule'
    );
  }
});

// Indexes
matchSchema.index({ tournamentId: 1, date: 1 });
matchSchema.index({ homeTeam: 1 });
matchSchema.index({ awayTeam: 1 });
matchSchema.index(
  { fixtureKey: 1 },
  {
    unique: true,
    name: 'fixture_key_unique',
    partialFilterExpression: { fixtureKey: { $type: 'string' } },
  }
);
matchSchema.index({ tournamentId: 1, stage: 1, groupKey: 1, leg: 1, round: 1 });
matchSchema.index(
  { tournamentId: 1, officialFixtureNumber: 1 },
  {
    unique: true,
    name: 'official_fixture_number_unique',
    partialFilterExpression: {
      isDeleted: false,
      officialFixtureNumber: { $type: 'number' },
    },
  }
);
matchSchema.index(
  { tournamentId: 1, bracketNodeKey: 1 },
  {
    unique: true,
    name: 'competition_bracket_node_match_unique',
    partialFilterExpression: { bracketNodeKey: { $type: 'string' } },
  }
);

export default mongoose.model<IMatch>('Match', matchSchema);
