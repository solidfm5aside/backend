import { createHash } from 'crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import CompetitionDraw, {
  CompetitionDrawStatus,
  CompetitionDrawType,
} from '@/models/competition-draw.model';
import CompetitionBracket, {
  CompetitionBracketNodeKind,
  CompetitionBracketSourceType,
  CompetitionBracketStatus,
} from '@/models/competition-bracket.model';
import CompetitionOperation, {
  CompetitionOperationStatus,
} from '@/models/competition-operation.model';
import Match, { MatchStage, MatchStatus } from '@/models/match.model';
import PlayerStats from '@/models/player-stats.model';
import Standings from '@/models/standings.model';
import Team from '@/models/team.model';
import Player from '@/models/player.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import Tournament, {
  CompetitionCommitteeDecisionMethod,
  CompetitionDrawMode,
  CompetitionTieBreaker,
  CompetitionTieResolutionStatus,
  CompetitionWorkflowState,
  FIXED_V2_COMPETITION_RULES,
  ICompetitionRules,
  TournamentFormat,
  TournamentStatus,
} from '@/models/tournament.model';
import TournamentEntry, {
  TournamentEntrySource,
  TournamentEntryStatus,
} from '@/models/tournament-entry.model';
import Venue from '@/models/venue.model';
import {
  generateGroupRoundRobinFixtures,
  scheduleRoundMatchweeks,
} from '@/utils/scheduler.util';
import {
  buildTournamentRosterSnapshotRows,
  findTournamentRosterLimitViolations,
} from '@/utils/roster.util';
import {
  buildKnockoutBracketPlan,
  buildCompetitionPlayerStatsSnapshot,
  buildStandingRankPersistenceRows,
  buildStandingsRevisionGuard,
  CommitteeResolutionLike,
  CompetitionTieCluster,
  deriveKnockoutProgression,
  ComparableStanding,
  createSeededCrossGroupPairings,
  DrawEntryLike,
  getFirstKnockoutStage,
  getMissingCompetitionDecisions,
  isCompetitionCompletionSatisfied,
  isValidKnockoutScoreWinner,
  KnockoutBracketNodePlan,
  KnockoutProgressionError,
  KnockoutStageLike,
  rankFixedCompetitionGroup,
  selectCompetitionTeamIdentity,
  nextStandingsRevision,
  validateResolvedKnockoutRound,
  withBracketNodeTeamIdentities,
} from '@/utils/competition.util';
import {
  fenceTeamLifecycle,
  fenceTeamLifecycles,
} from '@/services/team-lifecycle.service';
import { readCompetitionTeamIdentitySummaries } from '@/services/competition-entry-identity.service';
import {
  appendCommitteeResolutionDecision,
  selectActiveCommitteeResolutions,
} from '@/utils/committee-resolution.util';

type GroupKey = 'A' | 'B';

export class CompetitionError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'COMPETITION_ERROR',
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'CompetitionError';
  }
}

interface GroupAssignmentInput {
  entryId: string;
  groupKey: GroupKey;
  groupSlot: number;
}

interface FixturePlanItem {
  fixtureKey: string;
  groupKey: GroupKey;
  leg: 1 | 2;
  round: number;
  roundSlot: number;
  homeEntryId: string;
  awayEntryId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  date: string;
  venue: string;
}

interface FixturePlan {
  tournamentId: string;
  tournamentRevision: number;
  matchesPerDay: number;
  roundRobinLegs: 1 | 2;
  totalMatches: number;
  fixtures: FixturePlanItem[];
  planHash: string;
}

interface CompetitionStandingRow extends ComparableStanding {
  tournamentEntryId: string;
  groupKey: GroupKey;
  groupSlot: number;
  teamId: {
    _id: string;
    name: string;
    logo?: string;
  };
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsAgainst: number;
  rank: number;
}

interface ResolveCompetitionTieInput {
  expectedRevision: number;
  groupKey: GroupKey;
  basisHash: string;
  orderedTeamIds: string[];
  method: CompetitionCommitteeDecisionMethod;
  note?: string;
}

interface CompetitionRankingState {
  groups: Record<GroupKey, CompetitionStandingRow[]>;
  ties: CompetitionTieCluster[];
  unresolvedTies: CompetitionTieCluster[];
  staleResolutionBasisHashes: string[];
  groupStageComplete: boolean;
  canFinalizeQualification: boolean;
}

const GROUP_KEYS: GroupKey[] = ['A', 'B'];
const BRACKET_STAGES: MatchStage[] = [
  MatchStage.ROUND_OF_16,
  MatchStage.QUARTER_FINALS,
  MatchStage.SEMI_FINALS,
  MatchStage.FINAL,
  MatchStage.THIRD_PLACE,
];
const CHAMPIONSHIP_STAGES = new Set<MatchStage>([
  MatchStage.ROUND_OF_16,
  MatchStage.QUARTER_FINALS,
  MatchStage.SEMI_FINALS,
  MatchStage.FINAL,
]);
const EDITABLE_WORKFLOW_STATES = new Set<CompetitionWorkflowState>([
  CompetitionWorkflowState.SETUP,
  CompetitionWorkflowState.ENTRIES_READY,
  CompetitionWorkflowState.GROUPS_ASSIGNED,
]);

export const FIXED_V2_FORMAT_POLICY = Object.freeze({
  teamCount: 14,
  groupCount: 2,
  teamsPerGroup: 7,
  groupLegs: 1,
  groupGamesPerTeam: 6,
  qualifiersPerGroup: 4,
  rankingOrder: [
    CompetitionTieBreaker.POINTS,
    CompetitionTieBreaker.GOAL_DIFFERENCE,
    CompetitionTieBreaker.GOALS_FOR,
    CompetitionTieBreaker.HEAD_TO_HEAD,
    CompetitionTieBreaker.COMMITTEE_DECISION,
  ],
  headToHeadPolicy: 'completed_direct_result_for_two_team_tie',
  quarterFinalPairings: ['A1-B4', 'A2-B3', 'B1-A4', 'B2-A3'],
  knockoutLegs: 1,
  thirdPlaceMatch: false,
  maxRosterPlayers: 10,
});

const hashValue = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

const toPlainObject = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const requireObjectId = (value: string, label: string): void => {
  if (!Types.ObjectId.isValid(value)) {
    throw new CompetitionError(`Invalid ${label}`, 400, 'INVALID_OBJECT_ID');
  }
};

const requireIdempotencyKey = (key?: string): string => {
  const normalized = key?.trim();
  if (!normalized) {
    throw new CompetitionError(
      'Idempotency-Key header is required for this operation',
      400,
      'IDEMPOTENCY_KEY_REQUIRED'
    );
  }
  if (normalized.length > 200) {
    throw new CompetitionError('Idempotency-Key is too long', 400, 'INVALID_IDEMPOTENCY_KEY');
  }
  return normalized;
};

const getV2Tournament = async (tournamentId: string, session?: ClientSession) => {
  requireObjectId(tournamentId, 'tournament ID');
  const query = Tournament.findOne({ _id: tournamentId, isDeleted: false });
  if (session) query.session(session);
  const tournament = await query;
  if (!tournament) {
    throw new CompetitionError('Tournament not found', 404, 'TOURNAMENT_NOT_FOUND');
  }
  if (
    tournament.formatVersion !== 2 ||
    tournament.format !== TournamentFormat.TWO_GROUP_KNOCKOUT
  ) {
    throw new CompetitionError(
      'This endpoint is only available for v2 two-group tournaments',
      409,
      'NOT_V2_COMPETITION'
    );
  }
  if (!tournament.competitionRules) {
    throw new CompetitionError(
      'Tournament is missing its v2 competition rules document',
      409,
      'MISSING_COMPETITION_RULES'
    );
  }
  return tournament;
};

const assertExpectedRevision = (actual: number, expected: number): void => {
  if (actual !== expected) {
    throw new CompetitionError(
      'Tournament changed since it was loaded. Refresh and try again.',
      409,
      'STALE_WORKFLOW_REVISION',
      { expected, actual }
    );
  }
};

const updateTournamentWithRevision = async (
  tournamentId: string,
  expectedRevision: number,
  set: Record<string, unknown>,
  session: ClientSession
) => {
  const updated = await Tournament.findOneAndUpdate(
    {
      _id: tournamentId,
      formatVersion: 2,
      workflowRevision: expectedRevision,
      isDeleted: false,
    },
    { $set: set, $inc: { workflowRevision: 1 } },
    { new: true, runValidators: true, session }
  );
  if (!updated) {
    throw new CompetitionError(
      'Tournament changed during this operation. Refresh and try again.',
      409,
      'STALE_WORKFLOW_REVISION'
    );
  }
  return updated;
};

const getRuleBlockingIssues = (rules: ICompetitionRules): string[] => {
  const missingDecisions = getMissingCompetitionDecisions(rules);
  const issues = missingDecisions.map(
    (field) => `Missing required decision: ${field}`
  );
  const exactRules: Array<[keyof ICompetitionRules, unknown]> = [
    ['teamCount', FIXED_V2_COMPETITION_RULES.teamCount],
    ['groupCount', FIXED_V2_COMPETITION_RULES.groupCount],
    ['teamsPerGroup', FIXED_V2_COMPETITION_RULES.teamsPerGroup],
    ['roundRobinLegs', FIXED_V2_COMPETITION_RULES.roundRobinLegs],
    ['qualifiersPerGroup', FIXED_V2_COMPETITION_RULES.qualifiersPerGroup],
    ['drawMode', FIXED_V2_COMPETITION_RULES.drawMode],
    ['avoidSameGroupFirstRound', FIXED_V2_COMPETITION_RULES.avoidSameGroupFirstRound],
    ['thirdPlaceMatch', FIXED_V2_COMPETITION_RULES.thirdPlaceMatch],
    ['maxRosterPlayers', FIXED_V2_COMPETITION_RULES.maxRosterPlayers],
  ];
  for (const [field, expected] of exactRules) {
    if (missingDecisions.includes(field)) continue;
    if (rules[field] !== expected) {
      issues.push(`Rule ${field} must be ${JSON.stringify(expected)} for the fixed v2 format.`);
    }
  }
  if (
    !missingDecisions.includes('tieBreakers') &&
    (!Array.isArray(rules.tieBreakers) ||
      rules.tieBreakers.length !== FIXED_V2_COMPETITION_RULES.tieBreakers.length ||
      rules.tieBreakers.some(
        (tieBreaker, index) => tieBreaker !== FIXED_V2_COMPETITION_RULES.tieBreakers[index]
      ))
  ) {
    issues.push(
      `Rule tieBreakers must be ${JSON.stringify(FIXED_V2_COMPETITION_RULES.tieBreakers)} for the fixed v2 format.`
    );
  }
  return [...new Set(issues)];
};

const assertWorkflowEditable = (state: CompetitionWorkflowState): void => {
  if (!EDITABLE_WORKFLOW_STATES.has(state)) {
    throw new CompetitionError(
      'Competition setup is locked because fixtures have already been published',
      409,
      'COMPETITION_SETUP_LOCKED'
    );
  }
};

const runIdempotentTransaction = async <T>(
  tournamentId: string,
  operation: string,
  rawIdempotencyKey: string | undefined,
  request: unknown,
  work: (session: ClientSession) => Promise<T>
): Promise<{ data: T; replayed: boolean }> => {
  const idempotencyKey = requireIdempotencyKey(rawIdempotencyKey);
  const requestHash = hashValue(request);
  const receiptFilter = { tournamentId, operation, idempotencyKey };

  const existing = await CompetitionOperation.findOne(receiptFilter).lean();
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new CompetitionError(
        'This Idempotency-Key was already used with a different request',
        409,
        'IDEMPOTENCY_KEY_REUSED'
      );
    }
    if (existing.status === CompetitionOperationStatus.COMPLETED) {
      return { data: existing.result as T, replayed: true };
    }
    throw new CompetitionError(
      'An operation with this Idempotency-Key is already in progress',
      409,
      'OPERATION_IN_PROGRESS'
    );
  }

  const session = await mongoose.startSession();
  let result!: T;
  try {
    await session.withTransaction(async () => {
      await CompetitionOperation.create(
        [
          {
            tournamentId,
            operation,
            idempotencyKey,
            requestHash,
            status: CompetitionOperationStatus.PENDING,
          },
        ],
        { session }
      );

      result = await work(session);

      await CompetitionOperation.updateOne(
        receiptFilter,
        {
          $set: {
            status: CompetitionOperationStatus.COMPLETED,
            result: toPlainObject(result),
          },
        },
        { session }
      );
    });
    return { data: result, replayed: false };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const receipt = await CompetitionOperation.findOne(receiptFilter).lean();
      if (receipt && receipt.requestHash !== requestHash) {
        throw new CompetitionError(
          'This Idempotency-Key was already used with a different request',
          409,
          'IDEMPOTENCY_KEY_REUSED'
        );
      }
      if (receipt?.status === CompetitionOperationStatus.COMPLETED) {
        return { data: receipt.result as T, replayed: true };
      }
      throw new CompetitionError(
        'The operation conflicts with an already-created competition resource. Refresh and retry.',
        409,
        'NATURAL_KEY_CONFLICT'
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

const readCompetitionBracketState = async (
  tournamentId: string,
  session?: ClientSession
) => {
  const bracketQuery = CompetitionBracket.findOne({ tournamentId }).lean();
  if (session) bracketQuery.session(session);
  const bracket = await bracketQuery;
  const stages = Object.fromEntries(BRACKET_STAGES.map((stage) => [stage, []])) as Record<
    string,
    unknown[]
  >;
  if (!bracket) {
    return {
      bracketVersion: 2,
      status: 'not_created',
      bracketId: null,
      sourceDrawId: null,
      revision: null,
      championTeam: null,
      runnerUpTeam: null,
      thirdPlaceTeam: null,
      stages,
    };
  }

  const matchQuery = Match.find({ bracketId: bracket._id, isDeleted: false })
    .populate('homeTeam awayTeam winner', 'name logo')
    .lean();
  if (session) matchQuery.session(session);
  const matches = await matchQuery;
  const matchesByNode = new Map(
    matches
      .filter((match) => Boolean(match.bracketNodeKey))
      .map((match) => [match.bracketNodeKey!, toPlainObject(match)])
  );

  const teamIds = new Set<string>();
  for (const node of bracket.nodes) {
    for (const teamId of [
      node.homeTeamId,
      node.awayTeamId,
      node.winnerTeamId,
      node.loserTeamId,
    ]) {
      if (teamId) teamIds.add(teamId.toString());
    }
  }
  for (const teamId of [bracket.championTeamId, bracket.runnerUpTeamId, bracket.thirdPlaceTeamId]) {
    if (teamId) teamIds.add(teamId.toString());
  }
  const tournamentQuery = Tournament.findById(tournamentId)
    .select('workflowState')
    .lean();
  if (session) tournamentQuery.session(session);
  const identityTournament = await tournamentQuery;
  const competitionCompleted =
    identityTournament?.workflowState === CompetitionWorkflowState.COMPLETED;
  const identityByTeamId = await readCompetitionTeamIdentitySummaries(
    tournamentId,
    [...teamIds],
    competitionCompleted,
    session
  );
  const teamSummary = (teamId?: Types.ObjectId) => {
    if (!teamId) return null;
    const id = teamId.toString();
    return identityByTeamId.get(id) ?? { _id: id };
  };

  for (const node of [...bracket.nodes].sort((left, right) => left.slot - right.slot)) {
    if (!stages[node.stage]) stages[node.stage] = [];
    const match = matchesByNode.get(node.key);
    stages[node.stage].push({
      key: node.key,
      stage: node.stage,
      slot: node.slot,
      kind: node.kind,
      homeSource: node.homeSource,
      awaySource: node.awaySource,
      homeTeam: teamSummary(node.homeTeamId),
      awayTeam: teamSummary(node.awayTeamId),
      winnerTeam: teamSummary(node.winnerTeamId),
      loserTeam: teamSummary(node.loserTeamId),
      resolvedAt: node.resolvedAt ?? null,
      match: withBracketNodeTeamIdentities(match, {
        homeTeam: teamSummary(node.homeTeamId),
        awayTeam: teamSummary(node.awayTeamId),
        winner: teamSummary(node.winnerTeamId),
      }),
    });
  }

  return {
    bracketVersion: 2,
    status: bracket.status,
    bracketId: bracket._id.toString(),
    sourceDrawId: bracket.sourceDrawId.toString(),
    revision: bracket.revision,
    championTeam: teamSummary(bracket.championTeamId),
    runnerUpTeam: teamSummary(bracket.runnerUpTeamId),
    thirdPlaceTeam: teamSummary(bracket.thirdPlaceTeamId),
    championDecidedAt: bracket.championDecidedAt ?? null,
    thirdPlaceDecidedAt: bracket.thirdPlaceDecidedAt ?? null,
    stages,
  };
};

export const getCompetitionBracketState = async (tournamentId: string) => {
  await getV2Tournament(tournamentId);
  return readCompetitionBracketState(tournamentId);
};

export const getCompetitionOverview = async (tournamentId: string) => {
  const tournament = await getV2Tournament(tournamentId);
  const [entries, venueCount, groupMatchCounts, latestDraw, bracket] = await Promise.all([
    TournamentEntry.find({
      tournamentId,
      status: TournamentEntryStatus.ACTIVE,
      isDeleted: false,
    })
      .sort({ groupKey: 1, groupSlot: 1, createdAt: 1 })
      .lean(),
    Venue.countDocuments({ isDeleted: false }),
    Match.aggregate([
      {
        $match: {
          tournamentId: new Types.ObjectId(tournamentId),
          stage: MatchStage.GROUP_STAGE,
          isDeleted: false,
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    CompetitionDraw.findOne({
      tournamentId,
      type: CompetitionDrawType.KNOCKOUT,
    })
      .sort({ version: -1 })
      .lean(),
    readCompetitionBracketState(tournamentId),
  ]);
  const currentTeams = await Team.find({
    _id: { $in: entries.map((entry) => entry.teamId) },
    isDeleted: false,
  })
    .select('name logo city registrationStatus')
    .lean();
  const currentTeamById = new Map(
    currentTeams.map((team) => [team._id.toString(), team])
  );
  const competitionCompleted =
    tournament.workflowState === CompetitionWorkflowState.COMPLETED;
  const overviewEntries = entries.map((entry) => {
    const currentTeam = currentTeamById.get(entry.teamId.toString());
    const identity = selectCompetitionTeamIdentity(
      { name: entry.teamNameSnapshot, logo: entry.teamLogoSnapshot },
      currentTeam,
      competitionCompleted
    );
    return {
      ...entry,
      teamId: {
        _id: entry.teamId,
        city: currentTeam?.city,
        registrationStatus: currentTeam?.registrationStatus,
        ...identity,
      },
    };
  });

  const groupCounts = GROUP_KEYS.reduce<Record<GroupKey, number>>(
    (counts, key) => {
      counts[key] = entries.filter((entry) => entry.groupKey === key).length;
      return counts;
    },
    { A: 0, B: 0 }
  );
  const statusCounts = Object.fromEntries(
    groupMatchCounts.map((item: { _id: string; count: number }) => [item._id, item.count])
  );
  const ruleIssues = getRuleBlockingIssues(tournament.competitionRules!);
  const blockers = [...ruleIssues];
  if (entries.length !== tournament.competitionRules!.teamCount) {
    blockers.push(
      `Exactly ${tournament.competitionRules!.teamCount} active tournament entries are required.`
    );
  }
  for (const groupKey of GROUP_KEYS) {
    if (groupCounts[groupKey] !== tournament.competitionRules!.teamsPerGroup) {
      blockers.push(
        `Group ${groupKey} must contain exactly ${tournament.competitionRules!.teamsPerGroup} teams.`
      );
    }
  }
  if (venueCount === 0) blockers.push('At least one active venue is required.');
  const stageNodes = (bracket.stages[tournament.currentStage] ?? []) as Array<{
    match: null | { status?: string; winner?: unknown };
  }>;
  const currentRoundReady =
    stageNodes.length > 0 &&
    stageNodes.every(
      (node) => node.match?.status === MatchStatus.COMPLETED && Boolean(node.match.winner)
    );
  const thirdPlaceNodes = (bracket.stages[MatchStage.THIRD_PLACE] ?? []) as Array<{
    match: null | { status?: string; winner?: unknown };
  }>;
  const pendingThirdPlaceReady =
    thirdPlaceNodes.length === 1 &&
    thirdPlaceNodes[0].match?.status === MatchStatus.COMPLETED &&
    Boolean(thirdPlaceNodes[0].match.winner);
  const ranking = tournament.fixturesGenerated
    ? await calculateCompetitionRankingState(tournamentId)
    : null;

  return {
    tournament,
    entries: overviewEntries,
    formatPolicy: FIXED_V2_FORMAT_POLICY,
    readiness: {
      isReadyForFixturePreview: blockers.length === 0,
      blockers,
      missingDecisions: getMissingCompetitionDecisions(tournament.competitionRules!),
      entryCount: entries.length,
      groupCounts,
      venueCount,
    },
    progress: {
      workflowState: tournament.workflowState,
      workflowRevision: tournament.workflowRevision,
      groupMatches: statusCounts,
      latestDraw,
      bracket,
      ranking,
    },
    allowedActions: {
      editRules: EDITABLE_WORKFLOW_STATES.has(tournament.workflowState),
      editEntries: EDITABLE_WORKFLOW_STATES.has(tournament.workflowState),
      assignGroups:
        EDITABLE_WORKFLOW_STATES.has(tournament.workflowState) &&
        entries.length === tournament.competitionRules!.teamCount,
      previewFixtures:
        tournament.workflowState === CompetitionWorkflowState.GROUPS_ASSIGNED && blockers.length === 0,
      publishFixtures:
        tournament.workflowState === CompetitionWorkflowState.GROUPS_ASSIGNED && blockers.length === 0,
      finalizeQualification:
        tournament.workflowState === CompetitionWorkflowState.GROUP_STAGE &&
        ranking?.canFinalizeQualification === true,
      resolveTie:
        tournament.workflowState === CompetitionWorkflowState.GROUP_STAGE &&
        ranking?.groupStageComplete === true &&
        ranking.unresolvedTies.length > 0,
      createDraw: tournament.workflowState === CompetitionWorkflowState.QUALIFICATION_FINALIZED,
      progressKnockout:
        (tournament.workflowState === CompetitionWorkflowState.KNOCKOUT_STAGE &&
          currentRoundReady) ||
        (tournament.workflowState === CompetitionWorkflowState.COMPLETED &&
          tournament.competitionRules!.thirdPlaceMatch === true &&
          !tournament.thirdPlaceTeamId &&
          pendingThirdPlaceReady),
    },
  };
};

export const updateCompetitionRules = async (
  tournamentId: string,
  expectedRevision: number,
  changes: Partial<ICompetitionRules>
) => {
  const session = await mongoose.startSession();
  let updated: unknown;
  try {
    await session.withTransaction(async () => {
      const tournament = await getV2Tournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      assertWorkflowEditable(tournament.workflowState);

      for (const [field, value] of Object.entries(changes) as Array<
        [keyof ICompetitionRules, unknown]
      >) {
        const expected = FIXED_V2_COMPETITION_RULES[field];
        if (JSON.stringify(value) !== JSON.stringify(expected)) {
          throw new CompetitionError(
            `Rule ${field} is fixed for this competition format.`,
            409,
            'FIXED_COMPETITION_RULE',
            { field, expected }
          );
        }
      }
      const set: Record<string, unknown> = {
        'competitionRules.roundRobinLegs': FIXED_V2_COMPETITION_RULES.roundRobinLegs,
        'competitionRules.qualifiersPerGroup': FIXED_V2_COMPETITION_RULES.qualifiersPerGroup,
        'competitionRules.tieBreakers': [...FIXED_V2_COMPETITION_RULES.tieBreakers],
        'competitionRules.drawMode': FIXED_V2_COMPETITION_RULES.drawMode,
        'competitionRules.avoidSameGroupFirstRound':
          FIXED_V2_COMPETITION_RULES.avoidSameGroupFirstRound,
        'competitionRules.thirdPlaceMatch': FIXED_V2_COMPETITION_RULES.thirdPlaceMatch,
        'competitionRules.maxRosterPlayers': FIXED_V2_COMPETITION_RULES.maxRosterPlayers,
      };
      updated = await updateTournamentWithRevision(tournamentId, expectedRevision, set, session);
    });
    return updated;
  } finally {
    await session.endSession();
  }
};

export const listCompetitionEntries = async (tournamentId: string) => {
  await getV2Tournament(tournamentId);
  return TournamentEntry.find({ tournamentId, isDeleted: false })
    .populate('teamId', 'name logo city registrationStatus')
    .sort({ groupKey: 1, groupSlot: 1, createdAt: 1 });
};

export const addCompetitionEntry = async (
  tournamentId: string,
  teamId: string,
  expectedRevision: number,
  adminId?: string
) => {
  requireObjectId(teamId, 'team ID');
  const session = await mongoose.startSession();
  let created: unknown;
  let workflowRevision = expectedRevision;
  try {
    await session.withTransaction(async () => {
      const tournament = await getV2Tournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      assertWorkflowEditable(tournament.workflowState);

      const team = await fenceTeamLifecycle(teamId, session, {
        registrationStatus: 'registered',
      });
      if (!team) {
        const existingTeam = await Team.findOne({ _id: teamId, isDeleted: false })
          .select('registrationStatus')
          .session(session);
        if (!existingTeam) {
          throw new CompetitionError('Team not found', 404, 'TEAM_NOT_FOUND');
        }
        throw new CompetitionError(
          'Only registered teams can be entered in a tournament',
          409,
          'TEAM_NOT_REGISTERED'
        );
      }
      const entryCount = await TournamentEntry.countDocuments({
        tournamentId,
        status: TournamentEntryStatus.ACTIVE,
        isDeleted: false,
      }).session(session);
      if (entryCount >= tournament.competitionRules!.teamCount) {
        throw new CompetitionError(
          `This tournament already has its maximum ${tournament.competitionRules!.teamCount} teams`,
          409,
          'ENTRY_LIMIT_REACHED'
        );
      }

      const docs = await TournamentEntry.create(
        [
          {
            tournamentId,
            teamId,
            status: TournamentEntryStatus.ACTIVE,
            source: TournamentEntrySource.ADMIN,
            teamNameSnapshot: team.name,
            teamLogoSnapshot: team.logo,
            createdBy: adminId,
          },
        ],
        { session }
      );
      created = docs[0];

      const nextCount = entryCount + 1;
      const updatedTournament = await updateTournamentWithRevision(
        tournamentId,
        expectedRevision,
        {
          workflowState:
            nextCount === tournament.competitionRules!.teamCount
              ? CompetitionWorkflowState.ENTRIES_READY
              : CompetitionWorkflowState.SETUP,
        },
        session
      );
      workflowRevision = updatedTournament.workflowRevision;
    });
    return { entry: created, workflowRevision };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new CompetitionError(
        'This team is already entered in the tournament',
        409,
        'DUPLICATE_TOURNAMENT_ENTRY'
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

export const removeCompetitionEntry = async (
  tournamentId: string,
  entryId: string,
  expectedRevision: number
) => {
  requireObjectId(entryId, 'entry ID');
  const session = await mongoose.startSession();
  let workflowRevision = expectedRevision;
  try {
    await session.withTransaction(async () => {
      const tournament = await getV2Tournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      assertWorkflowEditable(tournament.workflowState);

      const entry = await TournamentEntry.findOneAndUpdate(
        {
          _id: entryId,
          tournamentId,
          status: TournamentEntryStatus.ACTIVE,
          isDeleted: false,
        },
        {
          $set: { status: TournamentEntryStatus.WITHDRAWN, isDeleted: true },
          $unset: { groupKey: 1, groupSlot: 1 },
        },
        { new: true, session }
      );
      if (!entry) throw new CompetitionError('Tournament entry not found', 404, 'ENTRY_NOT_FOUND');

      const updatedTournament = await updateTournamentWithRevision(
        tournamentId,
        expectedRevision,
        { workflowState: CompetitionWorkflowState.SETUP },
        session
      );
      workflowRevision = updatedTournament.workflowRevision;
    });
    return { entryId, removed: true, workflowRevision };
  } finally {
    await session.endSession();
  }
};

export const assignCompetitionGroups = async (
  tournamentId: string,
  expectedRevision: number,
  assignments: GroupAssignmentInput[]
) => {
  const session = await mongoose.startSession();
  let workflowRevision = expectedRevision;
  try {
    await session.withTransaction(async () => {
      const tournament = await getV2Tournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      assertWorkflowEditable(tournament.workflowState);

      const entries = await TournamentEntry.find({
        tournamentId,
        status: TournamentEntryStatus.ACTIVE,
        isDeleted: false,
      })
        .session(session)
        .lean();
      if (entries.length !== tournament.competitionRules!.teamCount) {
        throw new CompetitionError(
          `Exactly ${tournament.competitionRules!.teamCount} active entries are required before assigning groups`,
          409,
          'ENTRY_COUNT_INVALID'
        );
      }

      const activeEntryIds = new Set(entries.map((entry) => entry._id.toString()));
      const assignedEntryIds = new Set(assignments.map((assignment) => assignment.entryId));
      if (
        assignedEntryIds.size !== assignments.length ||
        assignedEntryIds.size !== activeEntryIds.size ||
        [...assignedEntryIds].some((id) => !activeEntryIds.has(id))
      ) {
        throw new CompetitionError(
          'Assignments must include every active tournament entry exactly once',
          400,
          'INCOMPLETE_GROUP_ASSIGNMENT'
        );
      }

      for (const groupKey of GROUP_KEYS) {
        const groupAssignments = assignments.filter(
          (assignment) => assignment.groupKey === groupKey
        );
        const slots = new Set(groupAssignments.map((assignment) => assignment.groupSlot));
        if (
          groupAssignments.length !== tournament.competitionRules!.teamsPerGroup ||
          slots.size !== tournament.competitionRules!.teamsPerGroup ||
          [...slots].some(
            (slot) => slot < 1 || slot > tournament.competitionRules!.teamsPerGroup
          )
        ) {
          throw new CompetitionError(
            `Group ${groupKey} must use each slot 1-${tournament.competitionRules!.teamsPerGroup} exactly once`,
            400,
            'INVALID_GROUP_SLOTS'
          );
        }
      }

      await TournamentEntry.updateMany(
        { tournamentId, status: TournamentEntryStatus.ACTIVE, isDeleted: false },
        { $unset: { groupKey: 1, groupSlot: 1 } },
        { session }
      );
      await TournamentEntry.bulkWrite(
        assignments.map((assignment) => ({
          updateOne: {
            filter: {
              _id: assignment.entryId,
              tournamentId: new Types.ObjectId(tournamentId),
              status: TournamentEntryStatus.ACTIVE,
              isDeleted: false,
            },
            update: {
              $set: {
                groupKey: assignment.groupKey,
                groupSlot: assignment.groupSlot,
              },
            },
          },
        })),
        { session, ordered: true }
      );

      const updatedTournament = await updateTournamentWithRevision(
        tournamentId,
        expectedRevision,
        { workflowState: CompetitionWorkflowState.GROUPS_ASSIGNED },
        session
      );
      workflowRevision = updatedTournament.workflowRevision;
    });

    const entries = await listCompetitionEntries(tournamentId);
    return { entries, workflowRevision };
  } finally {
    await session.endSession();
  }
};

const nextSaturdayAfter = (value: Date): Date => {
  const date = new Date(value);
  const daysUntilSaturday = (6 - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilSaturday);
  date.setUTCHours(10, 0, 0, 0);
  return date;
};

const buildFixturePlan = async (
  tournamentId: string,
  matchesPerDay: number,
  session?: ClientSession
): Promise<FixturePlan> => {
  const tournament = await getV2Tournament(tournamentId, session);
  if (tournament.workflowState !== CompetitionWorkflowState.GROUPS_ASSIGNED) {
    throw new CompetitionError(
      'Complete and save the 7/7 group assignment before previewing fixtures',
      409,
      'GROUPS_NOT_READY'
    );
  }

  const ruleIssues = getRuleBlockingIssues(tournament.competitionRules!);
  if (ruleIssues.length > 0) {
    throw new CompetitionError(
      'Competition rules are incomplete',
      409,
      'INCOMPLETE_COMPETITION_RULES',
      ruleIssues
    );
  }

  const entryQuery = TournamentEntry.find({
    tournamentId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  })
    .sort({ groupKey: 1, groupSlot: 1 })
    .lean();
  const venueQuery = Venue.find({ isDeleted: false }).sort({ importance: 1, name: 1 }).lean();
  if (session) {
    entryQuery.session(session);
    venueQuery.session(session);
  }
  // MongoDB transactions do not support parallel operations on one session,
  // so this shared preview/publication helper keeps its reads serialized.
  const entries = await entryQuery;
  const venues = await venueQuery;
  const currentTeamQuery = Team.find({
    _id: { $in: entries.map((entry) => entry.teamId) },
    isDeleted: false,
  })
    .select('name logo')
    .lean();
  if (session) currentTeamQuery.session(session);
  const currentTeams = await currentTeamQuery;
  const currentTeamById = new Map(
    currentTeams.map((team) => [team._id.toString(), team])
  );
  if (entries.length !== tournament.competitionRules!.teamCount) {
    throw new CompetitionError('Tournament entry count is no longer valid', 409, 'ENTRY_COUNT_INVALID');
  }
  if (venues.length === 0) {
    throw new CompetitionError('At least one active venue is required', 409, 'NO_ACTIVE_VENUES');
  }
  const dailyVenueCapacity = venues.length * 7;
  if (matchesPerDay > dailyVenueCapacity) {
    throw new CompetitionError(
      `matchesPerDay exceeds the ${dailyVenueCapacity}-match capacity of the active venues`,
      400,
      'DAILY_VENUE_CAPACITY_EXCEEDED',
      { venueCount: venues.length, dailyVenueCapacity }
    );
  }
  const fixturesPerGlobalRound =
    GROUP_KEYS.length * Math.floor(tournament.competitionRules!.teamsPerGroup / 2);
  if (matchesPerDay * 2 < fixturesPerGlobalRound) {
    throw new CompetitionError(
      `matchesPerDay must be at least ${Math.ceil(fixturesPerGlobalRound / 2)} so a complete ` +
        'group round fits within its Saturday/Sunday matchweek',
      400,
      'MATCHWEEK_CAPACITY_EXCEEDED',
      { fixturesPerGlobalRound, weekendCapacity: matchesPerDay * 2 }
    );
  }

  const entryById = new Map(entries.map((entry) => [entry._id.toString(), entry]));
  const roundsByGroup = new Map<GroupKey, ReturnType<typeof generateGroupRoundRobinFixtures>>();
  for (const groupKey of GROUP_KEYS) {
    const groupEntries = entries.filter((entry) => entry.groupKey === groupKey);
    if (groupEntries.length !== tournament.competitionRules!.teamsPerGroup) {
      throw new CompetitionError(
        `Group ${groupKey} must contain exactly ${tournament.competitionRules!.teamsPerGroup} teams`,
        409,
        'GROUP_SIZE_INVALID'
      );
    }
    roundsByGroup.set(
      groupKey,
      generateGroupRoundRobinFixtures(
        groupEntries.map((entry) => entry._id.toString()),
        tournament.competitionRules!.roundRobinLegs as 1 | 2
      )
    );
  }

  const fixtureSpecs: Array<{
    groupKey: GroupKey;
    leg: 1 | 2;
    round: number;
    roundSlot: number;
    homeEntryId: string;
    awayEntryId: string;
  }> = [];
  const maximumRound = Math.max(
    ...GROUP_KEYS.map((key) => roundsByGroup.get(key)!.at(-1)!.round)
  );
  for (let round = 1; round <= maximumRound; round++) {
    for (const groupKey of GROUP_KEYS) {
      const groupRound = roundsByGroup.get(groupKey)!.find((item) => item.round === round)!;
      for (const fixture of groupRound.fixtures) {
        fixtureSpecs.push({
          groupKey,
          leg: fixture.leg,
          round: fixture.round,
          roundSlot: fixture.roundSlot,
          homeEntryId: fixture.team1,
          awayEntryId: fixture.team2,
        });
      }
    }
  }

  const scheduledSpecs = scheduleRoundMatchweeks(
    fixtureSpecs,
    tournament.startDate,
    matchesPerDay
  );
  const fixtures: FixturePlanItem[] = scheduledSpecs.map(({ fixture: spec, matchDate, dailySlot }) => {
    const venueIndex = dailySlot % venues.length;
    const timeSlot = Math.floor(dailySlot / venues.length);
    const scheduledDate = new Date(matchDate);
    scheduledDate.setUTCHours(10 + timeSlot * 2, 0, 0, 0);

    const homeEntry = entryById.get(spec.homeEntryId)!;
    const awayEntry = entryById.get(spec.awayEntryId)!;
    const homeIdentity = selectCompetitionTeamIdentity(
      { name: homeEntry.teamNameSnapshot, logo: homeEntry.teamLogoSnapshot },
      currentTeamById.get(homeEntry.teamId.toString()),
      false
    );
    const awayIdentity = selectCompetitionTeamIdentity(
      { name: awayEntry.teamNameSnapshot, logo: awayEntry.teamLogoSnapshot },
      currentTeamById.get(awayEntry.teamId.toString()),
      false
    );
    return {
      fixtureKey: `${tournamentId}:group_stage:${spec.groupKey}:L${spec.leg}:R${spec.round}:M${spec.roundSlot}`,
      ...spec,
      homeTeamId: homeEntry.teamId.toString(),
      awayTeamId: awayEntry.teamId.toString(),
      homeTeamName: homeIdentity.name,
      awayTeamName: awayIdentity.name,
      date: scheduledDate.toISOString(),
      venue: venues[venueIndex].name,
    };
  });

  const unhashedPlan = {
    tournamentId,
    tournamentRevision: tournament.workflowRevision,
    matchesPerDay,
    roundRobinLegs: tournament.competitionRules!.roundRobinLegs as 1 | 2,
    totalMatches: fixtures.length,
    fixtures,
  };
  return { ...unhashedPlan, planHash: hashValue(unhashedPlan) };
};

export const previewGroupFixtures = async (
  tournamentId: string,
  matchesPerDay: number
): Promise<FixturePlan> => buildFixturePlan(tournamentId, matchesPerDay);

export const publishGroupFixtures = async (
  tournamentId: string,
  input: { expectedRevision: number; planHash: string; matchesPerDay: number },
  idempotencyKey?: string
) =>
  runIdempotentTransaction(
    tournamentId,
    'publish_group_fixtures',
    idempotencyKey,
    input,
    async (session) => {
      const plan = await buildFixturePlan(tournamentId, input.matchesPerDay, session);
      assertExpectedRevision(plan.tournamentRevision, input.expectedRevision);
      if (plan.planHash !== input.planHash) {
        throw new CompetitionError(
          'Fixture inputs changed after preview. Generate a new preview before publishing.',
          409,
          'FIXTURE_PLAN_CHANGED'
        );
      }

      const entries = await TournamentEntry.find({
        tournamentId,
        status: TournamentEntryStatus.ACTIVE,
        isDeleted: false,
      })
        .session(session)
        .lean();

      const enteredTeamIds = entries.map((entry) => entry.teamId.toString());
      const uniqueEnteredTeamIds = [...new Set(enteredTeamIds)];
      if (uniqueEnteredTeamIds.length !== FIXED_V2_COMPETITION_RULES.teamCount) {
        throw new CompetitionError(
          `Exactly ${FIXED_V2_COMPETITION_RULES.teamCount} distinct entered teams are required before publishing fixtures.`,
          409,
          'ENTRY_TEAM_COUNT_INVALID'
        );
      }

      // Player creation and transfer fence their Team documents before writing.
      // Lock every entered Team in the same deterministic order before reading
      // players, so publication captures either the complete pre-create or
      // complete post-create roster and never an in-between snapshot.
      const fencedTeams = await fenceTeamLifecycles(uniqueEnteredTeamIds, session, {
        registrationStatus: 'registered',
      });
      const unavailableTeamIds = [...fencedTeams.entries()]
        .filter(([, team]) => !team)
        .map(([teamId]) => teamId);
      if (unavailableTeamIds.length > 0) {
        throw new CompetitionError(
          'Every entered team must remain registered and available while fixtures are published.',
          409,
          'ENTERED_TEAM_UNAVAILABLE',
          { teamIds: unavailableTeamIds }
        );
      }

      const rosterPlayers = await Player.find({
        teamId: { $in: uniqueEnteredTeamIds },
        isDeleted: false,
      })
        .select(
          '+competitionRosterRevision name position jerseyNumber nationality passportPic teamId'
        )
        .session(session);
      const rosterEntries = entries.map((entry) => ({
        id: entry._id.toString(),
        teamId: entry.teamId.toString(),
      }));
      const rosterViolations = findTournamentRosterLimitViolations(
        rosterEntries,
        rosterPlayers.map((player) => ({ teamId: player.teamId.toString() })),
        FIXED_V2_COMPETITION_RULES.maxRosterPlayers
      );
      if (rosterViolations.length > 0) {
        const currentTeamNameById = new Map<string, string>();
        for (const fixture of plan.fixtures) {
          currentTeamNameById.set(fixture.homeTeamId, fixture.homeTeamName);
          currentTeamNameById.set(fixture.awayTeamId, fixture.awayTeamName);
        }
        throw new CompetitionError(
          'One or more teams exceed the maximum 10-player tournament roster. Remove or transfer players before publishing fixtures.',
          409,
          'ROSTER_LIMIT_EXCEEDED',
          rosterViolations.map((violation) => ({
            ...violation,
            teamName: currentTeamNameById.get(violation.teamId),
          }))
        );
      }

      await Match.insertMany(
        plan.fixtures.map((fixture) => ({
          tournamentId,
          homeTeam: fixture.homeTeamId,
          awayTeam: fixture.awayTeamId,
          date: new Date(fixture.date),
          venue: fixture.venue,
          stage: MatchStage.GROUP_STAGE,
          status: MatchStatus.SCHEDULED,
          groupKey: fixture.groupKey,
          leg: fixture.leg,
          round: fixture.round,
          fixtureKey: fixture.fixtureKey,
          events: [],
        })),
        { session, ordered: true }
      );

      const rosterCapturedAt = new Date();
      const rosterRows = buildTournamentRosterSnapshotRows(
        tournamentId,
        input.expectedRevision + 1,
        rosterEntries,
        rosterPlayers.map((player) => ({
          id: player._id.toString(),
          teamId: player.teamId.toString(),
          name: player.name,
          position: player.position,
          jerseyNumber: player.jerseyNumber,
          nationality: player.nationality,
          photo: player.passportPic,
        })),
        rosterCapturedAt
      );
      if (rosterPlayers.length > 0) {
        const rosterLockResult = await Player.bulkWrite(
          rosterPlayers.map((player) => {
            const revision = player.competitionRosterRevision ?? 0;
            return {
              updateOne: {
                filter: {
                  _id: player._id,
                  teamId: player.teamId,
                  isDeleted: false,
                  $or:
                    revision === 0
                      ? [
                          { competitionRosterRevision: 0 },
                          { competitionRosterRevision: { $exists: false } },
                        ]
                      : [{ competitionRosterRevision: revision }],
                },
                update: { $inc: { competitionRosterRevision: 1 } },
              },
            };
          }),
          { session }
        );
        if (rosterLockResult.modifiedCount !== rosterPlayers.length) {
          throw new CompetitionError(
            'A player changed while the tournament roster was being captured. Refresh and retry.',
            409,
            'ROSTER_SNAPSHOT_CONFLICT'
          );
        }
        await TournamentRosterEntry.insertMany(rosterRows, {
          session,
          ordered: true,
        });
      }
      await Standings.insertMany(
        entries.map((entry) => ({
          tournamentId,
          tournamentEntryId: entry._id,
          teamId: entry.teamId,
          groupKey: entry.groupKey,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          points: 0,
          fairPlayPoints: 0,
          revision: input.expectedRevision + 1,
        })),
        { session, ordered: true }
      );

      const updated = await updateTournamentWithRevision(
        tournamentId,
        input.expectedRevision,
        {
          workflowState: CompetitionWorkflowState.GROUP_STAGE,
          currentStage: MatchStage.GROUP_STAGE,
          fixturesGenerated: true,
          leagueRounds: 7 * plan.roundRobinLegs,
          status: TournamentStatus.ONGOING,
          standingsRevision: input.expectedRevision + 1,
        },
        session
      );

      return {
        tournamentId,
        workflowRevision: updated.workflowRevision,
        fixtureCount: plan.totalMatches,
        rosterPlayerCount: rosterRows.length,
        planHash: plan.planHash,
      };
    }
  );

const calculateCompetitionRankingState = async (
  tournamentId: string,
  session?: ClientSession,
  options: { ignoreStoredResolutions?: boolean } = {}
): Promise<CompetitionRankingState> => {
  const tournament = await getV2Tournament(tournamentId, session);
  const entryQuery = TournamentEntry.find({
    tournamentId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
    groupKey: { $in: GROUP_KEYS },
  })
    .sort({ groupKey: 1, groupSlot: 1 })
    .lean();
  const matchQuery = Match.find({
    tournamentId,
    stage: MatchStage.GROUP_STAGE,
    isDeleted: false,
  }).lean();
  if (session) {
    entryQuery.session(session);
    matchQuery.session(session);
  }
  // These queries share a session when called from a mutation/rebuild. Driver
  // transaction semantics require them to run sequentially.
  const entries = await entryQuery;
  const allMatches = await matchQuery;
  const teamQuery = Team.find({
    _id: { $in: entries.map((entry) => entry.teamId) },
    isDeleted: false,
  })
    .select('name logo')
    .lean();
  if (session) teamQuery.session(session);
  const currentTeams = await teamQuery;
  const currentTeamById = new Map(
    currentTeams.map((team) => [team._id.toString(), team])
  );
  const useHistoricalIdentity =
    tournament.workflowState === CompetitionWorkflowState.COMPLETED;

  const rowByTeamId = new Map<string, Omit<CompetitionStandingRow, 'rank'>>();
  for (const entry of entries) {
    const currentTeam = currentTeamById.get(entry.teamId.toString());
    const identity = selectCompetitionTeamIdentity(
      { name: entry.teamNameSnapshot, logo: entry.teamLogoSnapshot },
      currentTeam,
      useHistoricalIdentity
    );
    rowByTeamId.set(entry.teamId.toString(), {
      tournamentEntryId: entry._id.toString(),
      groupKey: entry.groupKey as GroupKey,
      groupSlot: entry.groupSlot!,
      teamId: {
        _id: entry.teamId.toString(),
        name: identity.name,
        logo: identity.logo,
      },
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    });
  }

  const completedMatches = allMatches.filter(
    (match) => match.status === MatchStatus.COMPLETED
  );
  for (const match of completedMatches) {
    const home = rowByTeamId.get(match.homeTeam.toString());
    const away = rowByTeamId.get(match.awayTeam.toString());
    if (!home || !away || home.groupKey !== away.groupKey || home.groupKey !== match.groupKey) {
      throw new CompetitionError(
        `Match ${match._id.toString()} has teams outside its assigned group`,
        409,
        'INVALID_GROUP_MATCH'
      );
    }

    home.played++;
    away.played++;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    if (match.homeScore > match.awayScore) {
      home.won++;
      home.points += 3;
      away.lost++;
    } else if (match.awayScore > match.homeScore) {
      away.won++;
      away.points += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
  }

  const resolutionAuditHistory = (tournament.competitionTieResolutions ?? []).map(
    (resolution, index) => ({
      decisionId: resolution.decisionId?.toString() ?? `legacy-${index}`,
      decisionRevision: resolution.decisionRevision ?? index + 1,
      status: resolution.status,
      groupKey: resolution.groupKey,
      basisHash: resolution.basisHash,
      decidedAt: resolution.decidedAt,
      resolution,
    })
  );
  const activeResolutionDocuments = selectActiveCommitteeResolutions(
    resolutionAuditHistory
  ).map((item) => item.resolution);
  const storedResolutions: CommitteeResolutionLike[] = options.ignoreStoredResolutions
    ? []
    : activeResolutionDocuments.map((resolution) => ({
        groupKey: resolution.groupKey,
        basisHash: resolution.basisHash,
        tiedTeamIds: resolution.tiedTeamIds.map((teamId) => teamId.toString()),
        orderedTeamIds: resolution.orderedTeamIds.map((teamId) => teamId.toString()),
        method: resolution.method,
        note: resolution.note,
        decidedAt: resolution.decidedAt,
      }));
  const rankingMatches = completedMatches.map((match) => ({
    homeTeamId: match.homeTeam.toString(),
    awayTeamId: match.awayTeam.toString(),
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    fixtureKey: match.fixtureKey,
  }));
  const groups: Record<GroupKey, CompetitionStandingRow[]> = { A: [], B: [] };
  const ties: CompetitionTieCluster[] = [];
  for (const groupKey of GROUP_KEYS) {
    const result = rankFixedCompetitionGroup(
      [...rowByTeamId.values()].filter((row) => row.groupKey === groupKey),
      {
        groupKey,
        teamIdOf: (row) => row.teamId._id,
        matches: rankingMatches,
        resolutions: storedResolutions,
        qualifiersPerGroup: FIXED_V2_COMPETITION_RULES.qualifiersPerGroup!,
      }
    );
    groups[groupKey] = result.rows as CompetitionStandingRow[];
    ties.push(...result.ties);
  }

  const currentBasisHashes = new Set(ties.map((tie) => tie.basisHash));
  const staleResolutionBasisHashes = [
    ...new Set(
      activeResolutionDocuments
        .map((resolution) => resolution.basisHash)
        .filter((basisHash) => !currentBasisHashes.has(basisHash))
    ),
  ];
  const expectedMatchCount =
    FIXED_V2_COMPETITION_RULES.groupCount *
    ((FIXED_V2_COMPETITION_RULES.teamsPerGroup *
      (FIXED_V2_COMPETITION_RULES.teamsPerGroup - 1)) /
      2);
  const groupStageComplete =
    allMatches.length === expectedMatchCount &&
    allMatches.every((match) => match.status === MatchStatus.COMPLETED);
  const unresolvedTies = ties.filter((tie) => !tie.resolved);
  return {
    groups,
    ties,
    unresolvedTies,
    staleResolutionBasisHashes,
    groupStageComplete,
    canFinalizeQualification:
      groupStageComplete &&
      !unresolvedTies.some((tie) => tie.affectsQualificationOrSeeding),
  };
};

export const calculateGroupedStandings = async (
  tournamentId: string,
  session?: ClientSession
): Promise<Record<GroupKey, CompetitionStandingRow[]>> =>
  (await calculateCompetitionRankingState(tournamentId, session)).groups;

export const getCompetitionRankingState = async (tournamentId: string) => {
  const tournament = await getV2Tournament(tournamentId);
  const ranking = await calculateCompetitionRankingState(tournamentId);
  const resolutionHistory = (tournament.competitionTieResolutions ?? [])
    .map((resolution, index) => ({
      decisionId: resolution.decisionId?.toString() ?? `legacy-${index}`,
      decisionRevision: resolution.decisionRevision ?? index + 1,
      status: resolution.status ?? CompetitionTieResolutionStatus.ACTIVE,
      groupKey: resolution.groupKey,
      basisHash: resolution.basisHash,
      tiedTeamIds: resolution.tiedTeamIds.map((teamId) => teamId.toString()),
      orderedTeamIds: resolution.orderedTeamIds.map((teamId) => teamId.toString()),
      method: resolution.method,
      note: resolution.note,
      decidedBy: resolution.decidedBy?.toString(),
      decidedAt: resolution.decidedAt,
      supersededAt: resolution.supersededAt,
      supersededByDecisionId: resolution.supersededByDecisionId?.toString(),
    }))
    .sort(
      (left, right) =>
        left.decisionRevision - right.decisionRevision ||
        left.decidedAt.getTime() - right.decidedAt.getTime()
    );
  return {
    tournamentId,
    workflowRevision: tournament.workflowRevision,
    rankingOrder: FIXED_V2_FORMAT_POLICY.rankingOrder,
    headToHeadPolicy: FIXED_V2_FORMAT_POLICY.headToHeadPolicy,
    resolutionHistory,
    ...ranking,
  };
};

const persistCompetitionStandingRows = async (
  tournamentId: string,
  rows: CompetitionStandingRow[],
  revision: number,
  session: ClientSession
): Promise<void> => {
  if (rows.length === 0) return;

  const persistenceRows = buildStandingRankPersistenceRows(
    rows,
    (row) => row.teamId._id
  );
  await Standings.bulkWrite(
    persistenceRows.map(({ teamId, rank, row }) => ({
      updateOne: {
        filter: {
          tournamentId: new Types.ObjectId(tournamentId),
          teamId: new Types.ObjectId(teamId),
          ...buildStandingsRevisionGuard(revision),
        },
        update: {
          $set: {
            tournamentEntryId: new Types.ObjectId(row.tournamentEntryId),
            groupKey: row.groupKey,
            rank,
            played: row.played,
            won: row.won,
            drawn: row.drawn,
            lost: row.lost,
            goalsFor: row.goalsFor,
            goalsAgainst: row.goalsAgainst,
            goalDifference: row.goalDifference,
            points: row.points,
            revision,
          },
        },
        upsert: true,
      },
    })),
    { session }
  );
};

export const persistCompetitionPlayerStats = async (
  tournamentId: string,
  matches: Array<{ status: string; events: Array<{
    type: string;
    playerId?: unknown;
    teamId: unknown;
    assistPlayerId?: unknown;
  }> }>,
  revision: number,
  session: ClientSession
): Promise<void> => {
  const tournamentObjectId = new Types.ObjectId(tournamentId);
  const snapshot = buildCompetitionPlayerStatsSnapshot(matches);
  if (snapshot.length > 0) {
    await PlayerStats.bulkWrite(
      snapshot.map((row) => ({
        updateOne: {
          filter: {
            tournamentId: tournamentObjectId,
            playerId: new Types.ObjectId(row.playerId),
            ...buildStandingsRevisionGuard(revision),
          },
          update: {
            $set: {
              teamId: new Types.ObjectId(row.teamId),
              goals: row.goals,
              assists: row.assists,
              yellowCards: row.yellowCards,
              redCards: row.redCards,
              matchesPlayed: row.matchesPlayed,
              revision,
            },
          },
          upsert: true,
        },
      })),
      { session }
    );
  }

  await PlayerStats.deleteMany({
    tournamentId: tournamentObjectId,
    $or: [
      { revision: { $exists: false } },
      { revision: { $lt: revision } },
    ],
  }).session(session);
};

const acquireStandingsRebuildFence = async (
  tournamentId: string,
  session: ClientSession
) => {
  const tournament = await getV2Tournament(tournamentId, session);
  await Tournament.updateOne(
    { _id: tournament._id },
    { $max: { standingsRevision: tournament.workflowRevision } },
    { session }
  );
  const fenced = await Tournament.findOneAndUpdate(
    {
      _id: tournament._id,
      formatVersion: 2,
      format: TournamentFormat.TWO_GROUP_KNOCKOUT,
      isDeleted: false,
    },
    { $inc: { standingsRevision: 1 } },
    { new: true, session }
  );
  if (!fenced) {
    throw new CompetitionError(
      'Tournament standings changed during recalculation. Retry the result update.',
      409,
      'STANDINGS_REBUILD_CONFLICT'
    );
  }
  return fenced;
};

export const resolveCompetitionTie = async (
  tournamentId: string,
  input: ResolveCompetitionTieInput,
  adminId?: string
) => {
  const session = await mongoose.startSession();
  let response: unknown;
  try {
    await session.withTransaction(async () => {
      const tournament = await getV2Tournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, input.expectedRevision);
      if (tournament.workflowState !== CompetitionWorkflowState.GROUP_STAGE) {
        throw new CompetitionError(
          'Committee tie decisions can be corrected only before qualification is finalized. Reopening qualification requires an explicit dependent-data rebuild.',
          409,
          'TIE_RESOLUTION_LOCKED'
        );
      }
      const rawRanking = await calculateCompetitionRankingState(tournamentId, session, {
        ignoreStoredResolutions: true,
      });
      if (!rawRanking.groupStageComplete) {
        throw new CompetitionError(
          'Complete every group-stage match before recording a committee tie decision.',
          409,
          'GROUP_STAGE_INCOMPLETE'
        );
      }
      const tie = rawRanking.unresolvedTies.find(
        (candidate) =>
          candidate.groupKey === input.groupKey &&
          candidate.basisHash === input.basisHash.toLowerCase()
      );
      if (!tie) {
        throw new CompetitionError(
          'This tie no longer matches the completed group results. Refresh the ranking and use its current basisHash.',
          409,
          'STALE_TIE_BASIS'
        );
      }
      for (const teamId of input.orderedTeamIds) requireObjectId(teamId, 'team ID');
      const orderedTeamIds = input.orderedTeamIds.map((teamId) =>
        new Types.ObjectId(teamId).toString()
      );
      const requestedIds = new Set(orderedTeamIds);
      if (
        requestedIds.size !== tie.teamIds.length ||
        orderedTeamIds.length !== tie.teamIds.length ||
        tie.teamIds.some((teamId) => !requestedIds.has(teamId))
      ) {
        throw new CompetitionError(
          'orderedTeamIds must contain every tied team exactly once.',
          422,
          'INVALID_COMMITTEE_ORDER',
          { expectedTeamIds: tie.teamIds }
        );
      }
      if (input.method === CompetitionCommitteeDecisionMethod.OTHER && !input.note?.trim()) {
        throw new CompetitionError(
          'A note is required for an other committee decision.',
          422,
          'COMMITTEE_NOTE_REQUIRED'
        );
      }

      const decidedAt = new Date();
      const resolution = {
        decisionId: new Types.ObjectId().toString(),
        decisionRevision: input.expectedRevision + 1,
        status: CompetitionTieResolutionStatus.ACTIVE,
        groupKey: input.groupKey,
        basisHash: tie.basisHash,
        tiedTeamIds: tie.teamIds,
        orderedTeamIds,
        method: input.method,
        note: input.note?.trim(),
        decidedBy: adminId,
        decidedAt,
      };
      const existingHistory = (tournament.competitionTieResolutions ?? []).map(
        (existing, index) => ({
          decisionId: existing.decisionId?.toString() ?? new Types.ObjectId().toString(),
          decisionRevision: existing.decisionRevision ?? index + 1,
          status: existing.status,
          groupKey: existing.groupKey,
          basisHash: existing.basisHash,
          tiedTeamIds: existing.tiedTeamIds.map((teamId) => teamId.toString()),
          orderedTeamIds: existing.orderedTeamIds.map((teamId) => teamId.toString()),
          method: existing.method,
          note: existing.note,
          decidedBy: existing.decidedBy?.toString(),
          decidedAt: existing.decidedAt,
          supersededAt: existing.supersededAt,
          supersededByDecisionId: existing.supersededByDecisionId?.toString(),
        })
      );
      const resolutionHistory = appendCommitteeResolutionDecision(
        existingHistory,
        resolution,
        decidedAt
      );
      const standingsRevision = nextStandingsRevision(
        tournament.standingsRevision,
        tournament.workflowRevision
      );
      const updated = await updateTournamentWithRevision(
        tournamentId,
        input.expectedRevision,
        {
          competitionTieResolutions: resolutionHistory,
          standingsRevision,
        },
        session
      );
      const ranking = await calculateCompetitionRankingState(tournamentId, session);
      await persistCompetitionStandingRows(
        tournamentId,
        [...ranking.groups.A, ...ranking.groups.B],
        standingsRevision,
        session
      );
      response = {
        workflowRevision: updated.workflowRevision,
        resolution: {
          decisionId: resolution.decisionId,
          decisionRevision: resolution.decisionRevision,
          status: resolution.status,
          groupKey: resolution.groupKey,
          basisHash: resolution.basisHash,
          tiedTeamIds: tie.teamIds,
          orderedTeamIds,
          method: resolution.method,
          note: resolution.note,
          decidedAt: resolution.decidedAt,
        },
        ranking,
      };
    });
    return response;
  } finally {
    await session.endSession();
  }
};

export const recalculateCompetitionStandingsInSession = async (
  tournamentId: string,
  session: ClientSession
): Promise<Record<GroupKey, CompetitionStandingRow[]>> => {
  const fencedTournament = await acquireStandingsRebuildFence(tournamentId, session);
  const groups = await calculateGroupedStandings(tournamentId, session);
  const statMatches = await Match.find({
      tournamentId,
      isDeleted: false,
      status: { $in: [MatchStatus.LIVE, MatchStatus.COMPLETED] },
    })
      .select('status events')
      .session(session)
      .lean();
  await persistCompetitionStandingRows(
    tournamentId,
    [...groups.A, ...groups.B],
    fencedTournament.standingsRevision,
    session
  );
  await persistCompetitionPlayerStats(
    tournamentId,
    statMatches,
    fencedTournament.standingsRevision,
    session
  );
  return groups;
};

export const recalculateCompetitionStandings = async (tournamentId: string) => {
  const session = await mongoose.startSession();
  let groups: Record<GroupKey, CompetitionStandingRow[]> = { A: [], B: [] };
  try {
    await session.withTransaction(async () => {
      groups = await recalculateCompetitionStandingsInSession(tournamentId, session);
    });
    return groups;
  } finally {
    await session.endSession();
  }
};

export const finalizeQualification = async (
  tournamentId: string,
  expectedRevision: number,
  idempotencyKey?: string
) =>
  runIdempotentTransaction(
    tournamentId,
    'finalize_qualification',
    idempotencyKey,
    { expectedRevision },
    async (session) => {
      const tournament = await getV2Tournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      if (tournament.workflowState !== CompetitionWorkflowState.GROUP_STAGE) {
        throw new CompetitionError(
          'Qualification can only be finalized after the group stage is published',
          409,
          'INVALID_WORKFLOW_STATE'
        );
      }

      const rules = tournament.competitionRules!;
      const ruleIssues = getRuleBlockingIssues(rules);
      if (ruleIssues.length > 0) {
        throw new CompetitionError(
          'Competition rules are incomplete',
          409,
          'INCOMPLETE_COMPETITION_RULES',
          ruleIssues
        );
      }
      const expectedMatchCount =
        rules.groupCount * ((rules.teamsPerGroup * (rules.teamsPerGroup - 1)) / 2) *
        (rules.roundRobinLegs as 1 | 2);
      const totalMatches = await Match.countDocuments({
          tournamentId,
          stage: MatchStage.GROUP_STAGE,
          isDeleted: false,
        }).session(session);
      const incompleteMatches = await Match.countDocuments({
          tournamentId,
          stage: MatchStage.GROUP_STAGE,
          isDeleted: false,
          status: { $ne: MatchStatus.COMPLETED },
        }).session(session);
      if (totalMatches !== expectedMatchCount || incompleteMatches > 0) {
        throw new CompetitionError(
          'Every expected group-stage match must be completed before qualification',
          409,
          'GROUP_STAGE_INCOMPLETE',
          { expectedMatchCount, totalMatches, incompleteMatches }
        );
      }
      const qualificationLockTime = new Date();
      const lockedGroupResults = await Match.updateMany(
        {
          tournamentId,
          stage: MatchStage.GROUP_STAGE,
          isDeleted: false,
          status: MatchStatus.COMPLETED,
          resultLockedAt: { $exists: false },
        },
        {
          $set: {
            resultLockedAt: qualificationLockTime,
            resultLockReason: 'qualification_finalized',
          },
          $inc: { __v: 1 },
        },
        { session }
      );
      if (lockedGroupResults.modifiedCount !== expectedMatchCount) {
        throw new CompetitionError(
          'A group-stage result changed during qualification. Refresh and retry.',
          409,
          'MATCH_RESULT_CONFLICT'
        );
      }

      const ranking = await calculateCompetitionRankingState(tournamentId, session);
      const unresolvedRelevantTies = ranking.unresolvedTies.filter(
        (tie) => tie.affectsQualificationOrSeeding
      );
      if (unresolvedRelevantTies.length > 0) {
        throw new CompetitionError(
          'A committee decision is required for every unresolved tie affecting a qualifying place or quarterfinal seed.',
          409,
          'UNRESOLVED_QUALIFICATION_TIE',
          { unresolvedTies: unresolvedRelevantTies }
        );
      }
      const groups = ranking.groups;
      const qualifiersPerGroup = FIXED_V2_COMPETITION_RULES.qualifiersPerGroup!;

      const qualified = GROUP_KEYS.flatMap((groupKey) =>
        groups[groupKey].slice(0, qualifiersPerGroup).map((row) => ({
          tournamentEntryId: row.tournamentEntryId,
          teamId: row.teamId._id,
          groupKey,
          rank: row.rank,
          points: row.points,
          goalDifference: row.goalDifference,
          goalsFor: row.goalsFor,
        }))
      );

      await Standings.bulkWrite(
        [...groups.A, ...groups.B].map((row) => ({
          updateOne: {
            filter: {
              tournamentId: new Types.ObjectId(tournamentId),
              teamId: new Types.ObjectId(row.teamId._id),
            },
            update: {
              $set: {
                tournamentEntryId: new Types.ObjectId(row.tournamentEntryId),
                groupKey: row.groupKey,
                rank: row.rank,
                played: row.played,
                won: row.won,
                drawn: row.drawn,
                lost: row.lost,
                goalsFor: row.goalsFor,
                goalsAgainst: row.goalsAgainst,
                goalDifference: row.goalDifference,
                points: row.points,
                revision: expectedRevision + 1,
              },
            },
            upsert: true,
          },
        })),
        { session }
      );

      const updated = await updateTournamentWithRevision(
        tournamentId,
        expectedRevision,
        {
          workflowState: CompetitionWorkflowState.QUALIFICATION_FINALIZED,
          qualificationSnapshot: qualified,
          qualificationFinalizedAt: new Date(),
        },
        session
      );
      return {
        tournamentId,
        workflowRevision: updated.workflowRevision,
        qualified,
      };
    }
  );

export const createKnockoutDraw = async (
  tournamentId: string,
  input: { expectedRevision: number },
  adminId: string | undefined,
  idempotencyKey?: string
) =>
  runIdempotentTransaction(
    tournamentId,
    'create_knockout_draw',
    idempotencyKey,
    input,
    async (session) => {
      const tournament = await getV2Tournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, input.expectedRevision);
      if (tournament.workflowState !== CompetitionWorkflowState.QUALIFICATION_FINALIZED) {
        throw new CompetitionError(
          'Finalize qualification before creating the knockout draw',
          409,
          'QUALIFICATION_NOT_FINALIZED'
        );
      }

      const rules = tournament.competitionRules!;
      const ruleIssues = getRuleBlockingIssues(rules);
      if (ruleIssues.length > 0) {
        throw new CompetitionError(
          'The tournament does not match the fixed v2 competition rules.',
          409,
          'INVALID_V2_RULES',
          ruleIssues
        );
      }
      const qualifierCount = tournament.qualificationSnapshot.length;
      const firstKnockoutStage = getFirstKnockoutStage(qualifierCount);
      if (qualifierCount !== 8 || firstKnockoutStage !== MatchStage.QUARTER_FINALS) {
        throw new CompetitionError(
          'The fixed v2 format requires exactly eight quarterfinal qualifiers.',
          422,
          'INVALID_V2_QUALIFIER_COUNT'
        );
      }
      const stage = MatchStage.QUARTER_FINALS;
      const mode = CompetitionDrawMode.SEEDED_CROSS_GROUP;
      const drawEntries: DrawEntryLike[] = tournament.qualificationSnapshot.map((entry) => ({
        entryId: entry.tournamentEntryId.toString(),
        teamId: entry.teamId.toString(),
        groupKey: entry.groupKey,
        rank: entry.rank,
      }));
      let pairings: ReturnType<typeof createSeededCrossGroupPairings>;
      try {
        pairings = createSeededCrossGroupPairings(drawEntries);
      } catch (error) {
        throw new CompetitionError(
          error instanceof Error ? error.message : 'The qualification seed data is invalid.',
          409,
          'INVALID_QUALIFICATION_SEEDS'
        );
      }

      const latestDraw = await CompetitionDraw.findOne({
        tournamentId,
        type: CompetitionDrawType.KNOCKOUT,
        stage,
      })
        .sort({ version: -1 })
        .session(session)
        .lean();
      const version = (latestDraw?.version ?? 0) + 1;
      await CompetitionDraw.updateMany(
        {
          tournamentId,
          type: CompetitionDrawType.KNOCKOUT,
          stage,
          status: CompetitionDrawStatus.DRAFT,
        },
        { $set: { status: CompetitionDrawStatus.SUPERSEDED } },
        { session }
      );
      const docs = await CompetitionDraw.create(
        [
          {
            tournamentId,
            type: CompetitionDrawType.KNOCKOUT,
            stage,
            version,
            status: CompetitionDrawStatus.DRAFT,
            mode,
            inputSnapshot: tournament.qualificationSnapshot.map((entry) => ({
              tournamentEntryId: entry.tournamentEntryId,
              teamId: entry.teamId,
              groupKey: entry.groupKey,
              groupRank: entry.rank,
            })),
            pairings: pairings.map((pairing, index) => ({
              slot: index + 1,
              homeEntryId: pairing.home.entryId,
              awayEntryId: pairing.away.entryId,
              homeTeamId: pairing.home.teamId,
              awayTeamId: pairing.away.teamId,
            })),
            rulesSnapshot: toPlainObject(rules) as unknown as Record<string, unknown>,
            createdBy: adminId,
          },
        ],
        { session }
      );

      const updated = await updateTournamentWithRevision(
        tournamentId,
        input.expectedRevision,
        {},
        session
      );
      return {
        draw: toPlainObject(docs[0]),
        workflowRevision: updated.workflowRevision,
      };
    }
  );

export const listCompetitionDraws = async (tournamentId: string) => {
  await getV2Tournament(tournamentId);
  return CompetitionDraw.find({ tournamentId, type: CompetitionDrawType.KNOCKOUT })
    .sort({ stage: 1, version: -1 })
    .populate('pairings.homeTeamId pairings.awayTeamId', 'name logo')
    .lean();
};

export const publishKnockoutDraw = async (
  tournamentId: string,
  drawId: string,
  expectedRevision: number,
  adminId: string | undefined,
  idempotencyKey?: string
) => {
  requireObjectId(drawId, 'draw ID');
  return runIdempotentTransaction(
    tournamentId,
    'publish_knockout_draw',
    idempotencyKey,
    { drawId, expectedRevision },
    async (session) => {
      const tournament = await getV2Tournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      if (tournament.workflowState !== CompetitionWorkflowState.QUALIFICATION_FINALIZED) {
        throw new CompetitionError(
          'The tournament is not ready to publish a knockout draw',
          409,
          'INVALID_WORKFLOW_STATE'
        );
      }

      const draw = await CompetitionDraw.findOne({
        _id: drawId,
        tournamentId,
        type: CompetitionDrawType.KNOCKOUT,
      }).session(session);
      if (!draw) throw new CompetitionError('Draw not found', 404, 'DRAW_NOT_FOUND');
      if (draw.status === CompetitionDrawStatus.SUPERSEDED) {
        throw new CompetitionError(
          'This draw was superseded by a newer draft',
          409,
          'DRAW_SUPERSEDED'
        );
      }
      if (draw.status !== CompetitionDrawStatus.DRAFT) {
        throw new CompetitionError(
          'Only the current draft draw can be published',
          409,
          'DRAW_NOT_PUBLISHABLE'
        );
      }
      if (draw.pairings.length * 2 !== draw.inputSnapshot.length) {
        throw new CompetitionError('Draft draw is incomplete', 409, 'INCOMPLETE_DRAW');
      }
      const ruleIssues = getRuleBlockingIssues(tournament.competitionRules!);
      if (ruleIssues.length > 0) {
        throw new CompetitionError(
          'The tournament does not match the fixed v2 competition rules.',
          409,
          'INVALID_V2_RULES',
          ruleIssues
        );
      }
      if (
        draw.stage !== MatchStage.QUARTER_FINALS ||
        draw.mode !== CompetitionDrawMode.SEEDED_CROSS_GROUP ||
        draw.inputSnapshot.length !== 8
      ) {
        throw new CompetitionError(
          'Only the fixed eight-team seeded quarterfinal draw can be published.',
          409,
          'INVALID_FIXED_DRAW'
        );
      }
      let expectedPairings: ReturnType<typeof createSeededCrossGroupPairings>;
      try {
        expectedPairings = createSeededCrossGroupPairings(
          draw.inputSnapshot.map((entry) => ({
            entryId: entry.tournamentEntryId.toString(),
            teamId: entry.teamId.toString(),
            groupKey: entry.groupKey,
            rank: entry.groupRank,
          }))
        );
      } catch (error) {
        throw new CompetitionError(
          error instanceof Error ? error.message : 'The saved draw seed data is invalid.',
          409,
          'INVALID_FIXED_DRAW'
        );
      }
      const savedPairings = [...draw.pairings].sort((left, right) => left.slot - right.slot);
      if (
        savedPairings.some(
          (pairing, index) =>
            pairing.slot !== index + 1 ||
            pairing.homeEntryId.toString() !== expectedPairings[index].home.entryId ||
            pairing.awayEntryId.toString() !== expectedPairings[index].away.entryId ||
            pairing.homeTeamId.toString() !== expectedPairings[index].home.teamId ||
            pairing.awayTeamId.toString() !== expectedPairings[index].away.teamId
        )
      ) {
        throw new CompetitionError(
          'The saved draw does not match A1-B4, A2-B3, B1-A4, B2-A3.',
          409,
          'FIXED_DRAW_PAIRING_MISMATCH'
        );
      }

      const venues = await Venue.find({ isDeleted: false })
        .sort({ importance: 1, name: 1 })
        .session(session)
        .lean();
      const lastMatch = await Match.findOne({ tournamentId, isDeleted: false })
        .sort({ date: -1 })
        .session(session)
        .lean();
      if (venues.length === 0) {
        throw new CompetitionError('At least one active venue is required', 409, 'NO_ACTIVE_VENUES');
      }
      const bracketPlan = buildKnockoutBracketPlan(8, false);
      const bracket = new CompetitionBracket({
        tournamentId,
        sourceDrawId: draw._id,
        entrantCount: draw.inputSnapshot.length,
        status: CompetitionBracketStatus.ACTIVE,
        revision: expectedRevision + 1,
        nodes: bracketPlan.map((node) => {
          const pairing = node.homeSource.drawPairingSlot
            ? draw.pairings.find((item) => item.slot === node.homeSource.drawPairingSlot)
            : undefined;
          return {
            ...node,
            stage: node.stage as MatchStage,
            kind:
              node.kind === 'championship'
                ? CompetitionBracketNodeKind.CHAMPIONSHIP
                : CompetitionBracketNodeKind.THIRD_PLACE,
            homeSource: {
              ...node.homeSource,
              type: node.homeSource.type as CompetitionBracketSourceType,
            },
            awaySource: {
              ...node.awaySource,
              type: node.awaySource.type as CompetitionBracketSourceType,
            },
            homeTeamId: pairing?.homeTeamId,
            awayTeamId: pairing?.awayTeamId,
          };
        }),
      });
      await bracket.save({ session });
      const firstDate = nextSaturdayAfter(lastMatch?.date ?? tournament.startDate);
      const firstRoundNodes = bracket.nodes
        .filter((node) => node.stage === draw.stage)
        .sort((left, right) => left.slot - right.slot);
      if (
        firstRoundNodes.length !== draw.pairings.length ||
        firstRoundNodes.some((node) => !node.homeTeamId || !node.awayTeamId)
      ) {
        throw new CompetitionError(
          'The durable bracket does not match the published draw',
          409,
          'BRACKET_DRAW_MISMATCH'
        );
      }
      const matchPayloads = firstRoundNodes.map((node, index) => {
        const date = new Date(firstDate);
        const venueIndex = index % venues.length;
        const timeSlot = Math.floor(index / venues.length);
        date.setUTCHours(10 + timeSlot * 2, 0, 0, 0);
        return {
          tournamentId,
          homeTeam: node.homeTeamId,
          awayTeam: node.awayTeamId,
          date,
          venue: venues[venueIndex].name,
          stage: draw.stage,
          status: MatchStatus.SCHEDULED,
          round: 1,
          fixtureKey: `${tournamentId}:knockout:${draw.stage}:M${node.slot}`,
          drawId: draw._id,
          bracketId: bracket._id,
          bracketNodeKey: node.key,
          bracketSlot: node.slot,
          events: [],
        };
      });
      const matchDocs = await Match.insertMany(matchPayloads, { session, ordered: true });
      const matchIdsByNode = new Map(
        matchDocs.map((match) => [match.bracketNodeKey!, match._id as Types.ObjectId])
      );
      for (const node of bracket.nodes) {
        const matchId = matchIdsByNode.get(node.key);
        if (matchId) node.matchId = matchId;
      }
      await bracket.save({ session });

      draw.status = CompetitionDrawStatus.PUBLISHED;
      draw.publishedBy = adminId ? new Types.ObjectId(adminId) : undefined;
      draw.publishedAt = new Date();
      await draw.save({ session });

      const updated = await updateTournamentWithRevision(
        tournamentId,
        expectedRevision,
        {
          workflowState: CompetitionWorkflowState.KNOCKOUT_STAGE,
          currentStage: draw.stage,
        },
        session
      );
      return {
        drawId: draw._id.toString(),
        bracketId: bracket._id.toString(),
        stage: draw.stage,
        fixtureCount: matchDocs.length,
        workflowRevision: updated.workflowRevision,
      };
    }
  );
};

const hasValidStoredKnockoutWinner = (match: {
  homeTeam: Types.ObjectId;
  awayTeam: Types.ObjectId;
  homeScore: number;
  awayScore: number;
  winner?: Types.ObjectId;
  shootoutScore?: { home?: number; away?: number };
}): boolean => {
  return isValidKnockoutScoreWinner({
    homeTeamId: match.homeTeam.toString(),
    awayTeamId: match.awayTeam.toString(),
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    winnerTeamId: match.winner?.toString(),
    shootoutScore: match.shootoutScore,
  });
};

const bracketPlansFromDocument = (
  nodes: Array<{
    key: string;
    stage: MatchStage;
    slot: number;
    kind: CompetitionBracketNodeKind;
    homeSource: {
      type: string;
      drawPairingSlot?: number;
      drawSide?: 'home' | 'away';
      sourceNodeKey?: string;
    };
    awaySource: {
      type: string;
      drawPairingSlot?: number;
      drawSide?: 'home' | 'away';
      sourceNodeKey?: string;
    };
  }>
): KnockoutBracketNodePlan[] =>
  nodes.map((node) => ({
    key: node.key,
    stage: node.stage as KnockoutStageLike,
    slot: node.slot,
    kind: node.kind,
    homeSource: {
      type: node.homeSource.type as 'draw_pairing' | 'winner' | 'loser',
      drawPairingSlot: node.homeSource.drawPairingSlot,
      drawSide: node.homeSource.drawSide,
      sourceNodeKey: node.homeSource.sourceNodeKey,
    },
    awaySource: {
      type: node.awaySource.type as 'draw_pairing' | 'winner' | 'loser',
      drawPairingSlot: node.awaySource.drawPairingSlot,
      drawSide: node.awaySource.drawSide,
      sourceNodeKey: node.awaySource.sourceNodeKey,
    },
  }));

const rethrowProgressionError = (error: unknown): never => {
  if (error instanceof KnockoutProgressionError) {
    throw new CompetitionError(error.message, 409, error.code);
  }
  throw error;
};

export const progressKnockout = async (
  tournamentId: string,
  expectedRevision: number,
  idempotencyKey?: string
) =>
  runIdempotentTransaction(
    tournamentId,
    'progress_knockout',
    idempotencyKey,
    { expectedRevision },
    async (session) => {
      const tournament = await getV2Tournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      const bracket = await CompetitionBracket.findOne({ tournamentId }).session(session);
      if (!bracket) {
        throw new CompetitionError(
          'Publish the first knockout draw before progressing the bracket',
          409,
          'BRACKET_NOT_CREATED'
        );
      }
      const ruleIssues = getRuleBlockingIssues(tournament.competitionRules!);
      const fixedPlan = buildKnockoutBracketPlan(8, false);
      const savedPlan = bracketPlansFromDocument(bracket.nodes);
      if (
        ruleIssues.length > 0 ||
        bracket.entrantCount !== 8 ||
        JSON.stringify(savedPlan) !== JSON.stringify(fixedPlan)
      ) {
        throw new CompetitionError(
          'The saved bracket does not match the fixed eight-team quarterfinal-to-final topology. An explicit bracket rebuild is required before progression.',
          409,
          'INVALID_FIXED_BRACKET',
          { ruleIssues }
        );
      }
      if (bracket.revision !== expectedRevision) {
        throw new CompetitionError(
          'Bracket and tournament revisions are out of sync',
          409,
          'BRACKET_REVISION_MISMATCH',
          { bracketRevision: bracket.revision, tournamentRevision: expectedRevision }
        );
      }

      const resolveThirdPlace = async () => {
        const thirdNode = bracket.nodes.find(
          (node) => node.kind === CompetitionBracketNodeKind.THIRD_PLACE
        );
        if (!thirdNode?.matchId) {
          throw new CompetitionError(
            'The third-place fixture has not been materialized',
            409,
            'THIRD_PLACE_NOT_MATERIALIZED'
          );
        }
        const thirdMatch = await Match.findOne({
          _id: thirdNode.matchId,
          bracketId: bracket._id,
          bracketNodeKey: thirdNode.key,
          isDeleted: false,
        }).session(session);
        if (!thirdMatch || !hasValidStoredKnockoutWinner(thirdMatch)) {
          throw new CompetitionError(
            'Complete the third-place match with a validated winner first',
            409,
            'THIRD_PLACE_INCOMPLETE'
          );
        }
        let resolved;
        try {
          resolved = validateResolvedKnockoutRound(
            [{ key: thirdNode.key }],
            [
              {
                nodeKey: thirdNode.key,
                status: thirdMatch.status,
                homeTeamId: thirdMatch.homeTeam.toString(),
                awayTeamId: thirdMatch.awayTeam.toString(),
                winnerTeamId: thirdMatch.winner!.toString(),
              },
            ]
          )[0];
        } catch (error) {
          return rethrowProgressionError(error);
        }
        const now = new Date();
        const locked = await Match.updateOne(
          {
            _id: thirdMatch._id,
            winner: new Types.ObjectId(resolved.winnerTeamId),
            status: MatchStatus.COMPLETED,
            resultLockedAt: { $exists: false },
          },
          {
            $set: {
              resultLockedAt: now,
              resultLockReason: 'third_place_recorded',
            },
            $inc: { __v: 1 },
          },
          { session }
        );
        if (locked.modifiedCount !== 1) {
          throw new CompetitionError(
            'The third-place result changed during progression. Refresh and retry.',
            409,
            'MATCH_RESULT_CONFLICT'
          );
        }
        thirdNode.winnerTeamId = new Types.ObjectId(resolved.winnerTeamId);
        thirdNode.loserTeamId = new Types.ObjectId(resolved.loserTeamId);
        thirdNode.resolvedAt = now;
        bracket.thirdPlaceTeamId = thirdNode.winnerTeamId;
        bracket.thirdPlaceDecidedAt = now;
        return thirdNode.winnerTeamId;
      };

      if (tournament.workflowState === CompetitionWorkflowState.COMPLETED) {
        const hasThirdPlaceNode = bracket.nodes.some(
          (node) => node.kind === CompetitionBracketNodeKind.THIRD_PLACE
        );
        if (
          tournament.competitionRules!.thirdPlaceMatch !== true ||
          !hasThirdPlaceNode ||
          tournament.thirdPlaceTeamId ||
          bracket.thirdPlaceTeamId
        ) {
          throw new CompetitionError(
            'Knockout progression has already been applied',
            409,
            'PROGRESSION_ALREADY_APPLIED'
          );
        }
        const thirdPlaceTeamId = await resolveThirdPlace();
        bracket.revision = expectedRevision + 1;
        await bracket.save({ session });
        const updated = await updateTournamentWithRevision(
          tournamentId,
          expectedRevision,
          { thirdPlaceTeamId },
          session
        );
        return {
          action: 'third_place_recorded' as const,
          thirdPlaceTeamId: thirdPlaceTeamId.toString(),
          championTeamId: bracket.championTeamId?.toString() ?? null,
          workflowRevision: updated.workflowRevision,
        };
      }

      if (tournament.workflowState !== CompetitionWorkflowState.KNOCKOUT_STAGE) {
        throw new CompetitionError(
          'The competition is not in its knockout stage',
          409,
          'INVALID_WORKFLOW_STATE'
        );
      }
      if (tournament.currentStage === MatchStage.THIRD_PLACE) {
        if (
          tournament.competitionRules!.thirdPlaceMatch !== true ||
          !bracket.championTeamId ||
          !bracket.runnerUpTeamId
        ) {
          throw new CompetitionError(
            'The competition is not waiting for a valid third-place result',
            409,
            'INVALID_THIRD_PLACE_STATE'
          );
        }
        const thirdPlaceTeamId = await resolveThirdPlace();
        const completedAt = new Date();
        bracket.revision = expectedRevision + 1;
        await bracket.save({ session });
        const updated = await updateTournamentWithRevision(
          tournamentId,
          expectedRevision,
          {
            workflowState: CompetitionWorkflowState.COMPLETED,
            status: TournamentStatus.COMPLETED,
            currentStage: MatchStage.THIRD_PLACE,
            thirdPlaceTeamId,
            competitionCompletedAt: completedAt,
          },
          session
        );
        return {
          action: 'competition_completed' as const,
          championTeamId: bracket.championTeamId.toString(),
          runnerUpTeamId: bracket.runnerUpTeamId.toString(),
          thirdPlaceTeamId: thirdPlaceTeamId.toString(),
          thirdPlacePending: false,
          workflowRevision: updated.workflowRevision,
        };
      }
      if (!CHAMPIONSHIP_STAGES.has(tournament.currentStage)) {
        throw new CompetitionError(
          'The current tournament stage cannot be progressed',
          409,
          'INVALID_KNOCKOUT_STAGE'
        );
      }

      const currentNodes = bracket.nodes
        .filter(
          (node) =>
            node.kind === CompetitionBracketNodeKind.CHAMPIONSHIP &&
            node.stage === tournament.currentStage
        )
        .sort((left, right) => left.slot - right.slot);
      if (currentNodes.some((node) => !node.matchId)) {
        throw new CompetitionError(
          'The current bracket round is missing a materialized match',
          409,
          'KNOCKOUT_ROUND_MISMATCH'
        );
      }
      const currentMatches = await Match.find({
        _id: { $in: currentNodes.map((node) => node.matchId!) },
        bracketId: bracket._id,
        stage: tournament.currentStage,
        isDeleted: false,
      }).session(session);
      const matchResults = currentMatches.map((match) => ({
        nodeKey: match.bracketNodeKey ?? '',
        status: match.status,
        homeTeamId: match.homeTeam.toString(),
        awayTeamId: match.awayTeam.toString(),
        winnerTeamId: hasValidStoredKnockoutWinner(match) ? match.winner!.toString() : null,
      }));

      let progression;
      try {
        progression = deriveKnockoutProgression(
          bracketPlansFromDocument(bracket.nodes),
          tournament.currentStage as Exclude<KnockoutStageLike, 'third_place'>,
          matchResults,
          bracket.nodes.filter((node) => Boolean(node.matchId)).map((node) => node.key)
        );
      } catch (error) {
        return rethrowProgressionError(error);
      }

      const resolvedAt = new Date();
      const matchIdsByNode = new Map(
        currentMatches.map((match) => [match.bracketNodeKey!, match._id as Types.ObjectId])
      );
      const lockedResults = await Match.updateMany(
        {
          bracketId: bracket._id,
          status: MatchStatus.COMPLETED,
          resultLockedAt: { $exists: false },
          $or: progression.resolved.map((resolved) => ({
            _id: matchIdsByNode.get(resolved.nodeKey),
            winner: new Types.ObjectId(resolved.winnerTeamId),
          })),
        },
        {
          $set: {
            resultLockedAt: resolvedAt,
            resultLockReason:
              progression.kind === 'complete'
                ? 'champion_recorded'
                : `advanced_to_${progression.nextStage}`,
          },
          $inc: { __v: 1 },
        },
        { session }
      );
      if (lockedResults.modifiedCount !== progression.resolved.length) {
        throw new CompetitionError(
          'A knockout result changed during progression. Refresh and retry.',
          409,
          'MATCH_RESULT_CONFLICT'
        );
      }
      for (const resolved of progression.resolved) {
        const node = bracket.nodes.find((item) => item.key === resolved.nodeKey)!;
        node.winnerTeamId = new Types.ObjectId(resolved.winnerTeamId);
        node.loserTeamId = new Types.ObjectId(resolved.loserTeamId);
        node.resolvedAt = resolvedAt;
      }

      if (progression.kind === 'complete') {
        let thirdPlaceTeamId: Types.ObjectId | undefined;
        const thirdNode = bracket.nodes.find(
          (node) => node.kind === CompetitionBracketNodeKind.THIRD_PLACE
        );
        const thirdPlaceRequired = tournament.competitionRules!.thirdPlaceMatch === true;
        if (thirdPlaceRequired && !thirdNode?.matchId) {
          throw new CompetitionError(
            'The required third-place fixture is missing from the bracket',
            409,
            'THIRD_PLACE_NOT_MATERIALIZED'
          );
        }
        if (thirdNode?.matchId) {
          const thirdMatch = await Match.findById(thirdNode.matchId).session(session);
          if (
            thirdMatch?.status === MatchStatus.COMPLETED &&
            hasValidStoredKnockoutWinner(thirdMatch)
          ) {
            thirdPlaceTeamId = await resolveThirdPlace();
          }
        }

        bracket.status = CompetitionBracketStatus.CHAMPION_DECIDED;
        bracket.championTeamId = new Types.ObjectId(progression.championTeamId);
        bracket.runnerUpTeamId = new Types.ObjectId(progression.runnerUpTeamId);
        bracket.championDecidedAt = resolvedAt;
        bracket.revision = expectedRevision + 1;
        await bracket.save({ session });

        const competitionCompleted = isCompetitionCompletionSatisfied(
          thirdPlaceRequired,
          Boolean(thirdPlaceTeamId)
        );
        const tournamentSet: Record<string, unknown> = {
          workflowState: competitionCompleted
            ? CompetitionWorkflowState.COMPLETED
            : CompetitionWorkflowState.KNOCKOUT_STAGE,
          status: competitionCompleted ? TournamentStatus.COMPLETED : TournamentStatus.ONGOING,
          currentStage: competitionCompleted ? MatchStage.FINAL : MatchStage.THIRD_PLACE,
          championTeamId: bracket.championTeamId,
          runnerUpTeamId: bracket.runnerUpTeamId,
        };
        if (competitionCompleted) tournamentSet.competitionCompletedAt = resolvedAt;
        if (thirdPlaceTeamId) tournamentSet.thirdPlaceTeamId = thirdPlaceTeamId;
        const updated = await updateTournamentWithRevision(
          tournamentId,
          expectedRevision,
          tournamentSet,
          session
        );
        return {
          action: competitionCompleted
            ? ('competition_completed' as const)
            : ('champion_recorded' as const),
          championTeamId: bracket.championTeamId.toString(),
          runnerUpTeamId: bracket.runnerUpTeamId.toString(),
          thirdPlaceTeamId: thirdPlaceTeamId?.toString() ?? null,
          thirdPlacePending: thirdPlaceRequired && !thirdPlaceTeamId,
          workflowRevision: updated.workflowRevision,
        };
      }

      const venues = await Venue.find({ isDeleted: false })
        .sort({ importance: 1, name: 1 })
        .session(session)
        .lean();
      if (venues.length === 0) {
        throw new CompetitionError('At least one active venue is required', 409, 'NO_ACTIVE_VENUES');
      }
      const lastCurrentDate = new Date(
        Math.max(...currentMatches.map((match) => match.date.getTime()))
      );
      const firstDate = nextSaturdayAfter(lastCurrentDate);
      const includesThirdPlace = progression.fixtures.some(
        (fixture) => fixture.kind === 'third_place'
      );
      let championshipIndex = 0;
      let thirdPlaceIndex = 0;
      const matchPayloads = progression.fixtures.map((fixture) => {
        const thirdPlace = fixture.kind === 'third_place';
        const dailyIndex = thirdPlace ? thirdPlaceIndex++ : championshipIndex++;
        const date = new Date(firstDate);
        if (includesThirdPlace && !thirdPlace) date.setUTCDate(date.getUTCDate() + 1);
        const venueIndex = dailyIndex % venues.length;
        const timeSlot = Math.floor(dailyIndex / venues.length);
        date.setUTCHours(10 + timeSlot * 2, 0, 0, 0);
        return {
          tournamentId,
          homeTeam: fixture.homeTeamId,
          awayTeam: fixture.awayTeamId,
          date,
          venue: venues[venueIndex].name,
          stage: fixture.stage as MatchStage,
          status: MatchStatus.SCHEDULED,
          round: 1,
          fixtureKey: `${tournamentId}:knockout:${fixture.stage}:M${fixture.slot}`,
          bracketId: bracket._id,
          bracketNodeKey: fixture.nodeKey,
          bracketSlot: fixture.slot,
          events: [],
        };
      });
      const createdMatches = await Match.insertMany(matchPayloads, {
        session,
        ordered: true,
      });
      const createdByNode = new Map(
        createdMatches.map((match) => [match.bracketNodeKey!, match])
      );
      for (const fixture of progression.fixtures) {
        const node = bracket.nodes.find((item) => item.key === fixture.nodeKey)!;
        const match = createdByNode.get(fixture.nodeKey)!;
        node.homeTeamId = new Types.ObjectId(fixture.homeTeamId);
        node.awayTeamId = new Types.ObjectId(fixture.awayTeamId);
        node.matchId = match._id as Types.ObjectId;
      }
      bracket.revision = expectedRevision + 1;
      await bracket.save({ session });

      const updated = await updateTournamentWithRevision(
        tournamentId,
        expectedRevision,
        { currentStage: progression.nextStage as MatchStage },
        session
      );
      return {
        action: 'round_materialized' as const,
        stage: progression.nextStage,
        fixtureCount: createdMatches.length,
        fixtures: createdMatches.map((match) => ({
          matchId: match._id.toString(),
          bracketNodeKey: match.bracketNodeKey,
          stage: match.stage,
          homeTeamId: match.homeTeam.toString(),
          awayTeamId: match.awayTeam.toString(),
          date: match.date,
        })),
        workflowRevision: updated.workflowRevision,
      };
    }
  );
