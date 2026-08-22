import { createHash } from 'crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import CompetitionOperation, {
  CompetitionOperationStatus,
} from '@/models/competition-operation.model';
import CompetitionBracket from '@/models/competition-bracket.model';
import CompetitionDraw from '@/models/competition-draw.model';
import Match, {
  MatchFixtureSource,
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import Player from '@/models/player.model';
import PlayerStats from '@/models/player-stats.model';
import Standings from '@/models/standings.model';
import Team from '@/models/team.model';
import Tournament, {
  CompetitionCommitteeDecisionMethod,
  CompetitionTieResolutionStatus,
  CompetitionWorkflowState,
  FIXED_WOMENS_COMPETITION_RULES,
  ICompetitionRules,
  TournamentFormat,
  TournamentStatus,
} from '@/models/tournament.model';
import TournamentEntry, {
  TournamentEntrySource,
  TournamentEntryStatus,
} from '@/models/tournament-entry.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import Venue from '@/models/venue.model';
import WomensCompetitionFinal, {
  WomensFinalStatus,
} from '@/models/womens-competition-final.model';
import {
  CompetitionDivision,
  resolveCompetitionDivision,
} from '@/models/competition-division';
import { CompetitionError, persistCompetitionPlayerStats } from './competition.service';
import {
  fenceTeamLifecycle,
  fenceTeamLifecycles,
} from './team-lifecycle.service';
import {
  fenceActiveVenueNames,
  VenueMutationError,
} from './venue-lifecycle.service';
import {
  buildTournamentRosterSnapshotRows,
  findTournamentRosterLimitViolations,
} from '@/utils/roster.util';
import {
  buildStandingRankPersistenceRows,
  buildStandingsRevisionGuard,
  CommitteeResolutionLike,
  isValidKnockoutScoreWinner,
  nextStandingsRevision,
  rankFixedCompetitionGroup,
  selectCompetitionTeamIdentity,
} from '@/utils/competition.util';
import {
  appendCommitteeResolutionDecision,
  selectActiveCommitteeResolutions,
} from '@/utils/committee-resolution.util';
import { competitionLocalCalendarDay } from '@/utils/official-fixture.util';
import {
  buildWomensLeagueFixturePlanCore,
  WomensCompetitionPlanError,
  WomensLeagueFixtureInput,
} from '@/utils/womens-competition.util';
import { readCompetitionTeamIdentitySummaries } from './competition-entry-identity.service';

const WOMENS_TIME_ZONE = 'Africa/Lagos' as const;
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const EDITABLE_STATES = new Set<CompetitionWorkflowState>([
  CompetitionWorkflowState.SETUP,
  CompetitionWorkflowState.ENTRIES_READY,
]);

export const WOMENS_FORMAT_POLICY = Object.freeze({
  teamCount: 3,
  leagueLegs: 1,
  leagueMatches: 3,
  leagueMatchesPerTeam: 2,
  qualifiersOverall: 2,
  finalLegs: 1,
  rankingOrder: [...FIXED_WOMENS_COMPETITION_RULES.tieBreakers],
  headToHeadPolicy: 'completed_direct_result_for_two_team_tie',
  thirdPlaceMatch: false,
  maxRosterPlayers: 10,
  scheduling: 'physical_official',
});

interface WomensStandingRow {
  tournamentEntryId: string;
  tableSlot: number;
  teamId: { _id: string; name: string; logo?: string };
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  rank: number;
}

interface WomensLeaguePlan {
  tournamentId: string;
  tournamentRevision: number;
  format: TournamentFormat.SINGLE_TABLE_FINAL;
  division: CompetitionDivision.WOMEN;
  stage: MatchStage.LEAGUE;
  timeZone: typeof WOMENS_TIME_ZONE;
  sourceReference: string | null;
  totalMatches: 3;
  confirmedCount: number;
  pendingCount: number;
  fixtures: ReturnType<typeof buildWomensLeagueFixturePlanCore>['fixtures'];
  planHash: string;
}

interface WomensFinalPlan {
  tournamentId: string;
  tournamentRevision: number;
  format: TournamentFormat.SINGLE_TABLE_FINAL;
  division: CompetitionDivision.WOMEN;
  stage: MatchStage.FINAL;
  timeZone: typeof WOMENS_TIME_ZONE;
  sourceReference: string | null;
  officialNumber: 4;
  fixtureKey: string;
  homeQualificationRank: 1;
  awayQualificationRank: 2;
  homeEntryId: string;
  awayEntryId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: string | null;
  venue: string | null;
  scheduleStatus: MatchScheduleStatus;
  planHash: string;
}

const hashValue = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const toPlainObject = <T>(value: T): T => {
  if (value && typeof value === 'object' && 'toObject' in value) {
    return (value as { toObject: () => T }).toObject();
  }
  return value;
};

const requireObjectId = (value: string, label: string): void => {
  if (!OBJECT_ID_PATTERN.test(value)) {
    throw new CompetitionError(`Invalid ${label}`, 400, 'INVALID_OBJECT_ID');
  }
};

const requireIdempotencyKey = (value?: string): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw new CompetitionError(
      'Idempotency-Key header is required for this operation',
      400,
      'IDEMPOTENCY_KEY_REQUIRED'
    );
  }
  if (normalized.length > 200) {
    throw new CompetitionError(
      'Idempotency-Key header must be at most 200 characters',
      400,
      'IDEMPOTENCY_KEY_INVALID'
    );
  }
  return normalized;
};

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

const getWomensTournament = async (tournamentId: string, session?: ClientSession) => {
  requireObjectId(tournamentId, 'tournament ID');
  const query = Tournament.findOne({ _id: tournamentId, isDeleted: false }).select(
    '+scheduleRevision +rosterIdentityRevision'
  );
  if (session) query.session(session);
  const tournament = await query;
  if (!tournament) {
    throw new CompetitionError('Tournament not found', 404, 'TOURNAMENT_NOT_FOUND');
  }
  if (
    tournament.formatVersion !== 3 ||
    tournament.format !== TournamentFormat.SINGLE_TABLE_FINAL ||
    resolveCompetitionDivision(tournament.division) !== CompetitionDivision.WOMEN
  ) {
    throw new CompetitionError(
      'This endpoint is only available for the women’s single-table final format',
      409,
      'NOT_WOMENS_COMPETITION'
    );
  }
  if (!tournament.competitionRules) {
    throw new CompetitionError(
      'Tournament is missing its women’s competition rules document',
      409,
      'MISSING_COMPETITION_RULES'
    );
  }
  return tournament;
};

export const isWomensCompetition = async (tournamentId: string): Promise<boolean> => {
  if (!OBJECT_ID_PATTERN.test(tournamentId)) return false;
  return Boolean(
    await Tournament.exists({
      _id: tournamentId,
      formatVersion: 3,
      format: TournamentFormat.SINGLE_TABLE_FINAL,
      division: CompetitionDivision.WOMEN,
      isDeleted: false,
    })
  );
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

const updateWomensTournamentWithRevision = async (
  tournamentId: string,
  expectedRevision: number,
  set: Record<string, unknown>,
  session: ClientSession,
  options: { scheduleChanged?: boolean } = {}
) => {
  const updated = await Tournament.findOneAndUpdate(
    {
      _id: tournamentId,
      formatVersion: 3,
      format: TournamentFormat.SINGLE_TABLE_FINAL,
      division: CompetitionDivision.WOMEN,
      workflowRevision: expectedRevision,
      isDeleted: false,
    },
    {
      $set: set,
      $inc: {
        workflowRevision: 1,
        ...(options.scheduleChanged ? { scheduleRevision: 1 } : {}),
      },
    },
    { new: true, runValidators: true, session }
  ).select('+scheduleRevision');
  if (!updated) {
    throw new CompetitionError(
      'Tournament changed during this operation. Refresh and try again.',
      409,
      'STALE_WORKFLOW_REVISION'
    );
  }
  return updated;
};

const assertWomensRules = (rules: ICompetitionRules): void => {
  const expected = FIXED_WOMENS_COMPETITION_RULES;
  const scalarFields: Array<keyof ICompetitionRules> = [
    'teamCount',
    'groupCount',
    'teamsPerGroup',
    'roundRobinLegs',
    'qualifiersPerGroup',
    'drawMode',
    'avoidSameGroupFirstRound',
    'thirdPlaceMatch',
    'maxRosterPlayers',
  ];
  const mismatches = scalarFields.filter((field) => rules[field] !== expected[field]);
  if (
    !Array.isArray(rules.tieBreakers) ||
    rules.tieBreakers.length !== expected.tieBreakers.length ||
    rules.tieBreakers.some((value, index) => value !== expected.tieBreakers[index])
  ) {
    mismatches.push('tieBreakers');
  }
  if (mismatches.length > 0) {
    throw new CompetitionError(
      'The tournament does not match the fixed women’s competition rules.',
      409,
      'INVALID_WOMENS_RULES',
      { fields: [...new Set(mismatches)] }
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

const fenceWomensVenueNames = async (
  venueNames: Iterable<string>,
  session: ClientSession
): Promise<Map<string, string>> => {
  try {
    return await fenceActiveVenueNames(venueNames, session);
  } catch (error) {
    if (error instanceof VenueMutationError) {
      throw new CompetitionError(error.message, error.statusCode, error.code);
    }
    throw error;
  }
};

const assertNoExistingScheduleCollisions = async (
  fixtures: Array<{
    officialNumber: number;
    homeTeamId: string;
    awayTeamId: string;
    kickoffAt: string | null;
    venue: string | null;
  }>,
  session: ClientSession,
  excludeMatchIds: string[] = []
): Promise<void> => {
  const confirmed = fixtures.filter(
    (fixture): fixture is typeof fixture & { kickoffAt: string; venue: string } =>
      fixture.kickoffAt !== null && fixture.venue !== null
  );
  if (confirmed.length === 0) return;
  const existingMatches = await Match.find({
    ...(excludeMatchIds.length > 0 ? { _id: { $nin: excludeMatchIds } } : {}),
    isDeleted: false,
    scheduleStatus: MatchScheduleStatus.CONFIRMED,
    date: { $exists: true },
  })
    .select('homeTeam awayTeam date venue')
    .session(session)
    .lean();
  for (const fixture of confirmed) {
    const kickoffAt = new Date(fixture.kickoffAt);
    const localDay = competitionLocalCalendarDay(kickoffAt, WOMENS_TIME_ZONE);
    const participantIds = new Set([fixture.homeTeamId, fixture.awayTeamId]);
    for (const existing of existingMatches) {
      if (!existing.date) continue;
      if (
        existing.venue?.trim().toLocaleLowerCase() ===
          fixture.venue.trim().toLocaleLowerCase() &&
        existing.date.getTime() === kickoffAt.getTime()
      ) {
        throw new CompetitionError(
          'An existing fixture already uses this venue at the requested kickoff.',
          422,
          'WOMENS_EXISTING_VENUE_COLLISION',
          { officialNumber: fixture.officialNumber, venue: fixture.venue }
        );
      }
      const sharesTeam =
        participantIds.has(existing.homeTeam.toString()) ||
        participantIds.has(existing.awayTeam.toString());
      if (sharesTeam && competitionLocalCalendarDay(existing.date, WOMENS_TIME_ZONE) === localDay) {
        throw new CompetitionError(
          'A team already has another fixture on this local calendar day.',
          422,
          'WOMENS_EXISTING_TEAM_DAY_COLLISION',
          { officialNumber: fixture.officialNumber, localDay }
        );
      }
    }
  }
};

export const listWomensEntries = async (tournamentId: string) => {
  await getWomensTournament(tournamentId);
  const rows = await TournamentEntry.find({ tournamentId, isDeleted: false })
    .populate('teamId', 'name logo city registrationStatus division')
    .sort({ groupSlot: 1, createdAt: 1 })
    .lean();
  return rows.map((row) => {
    const { groupKey: _groupKey, groupSlot, ...entry } = row;
    return { ...entry, tableSlot: groupSlot };
  });
};

export const addWomensEntry = async (
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
      const tournament = await getWomensTournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      if (!EDITABLE_STATES.has(tournament.workflowState)) {
        throw new CompetitionError(
          'Competition entries are locked because fixtures have already been published.',
          409,
          'COMPETITION_SETUP_LOCKED'
        );
      }
      assertWomensRules(tournament.competitionRules!);

      const team = await fenceTeamLifecycle(teamId, session, {
        registrationStatus: 'registered',
      });
      if (!team) {
        const existingTeam = await Team.findOne({ _id: teamId, isDeleted: false })
          .select('registrationStatus division')
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
      if (resolveCompetitionDivision(team.division) !== CompetitionDivision.WOMEN) {
        throw new CompetitionError(
          'Only women’s teams can be entered in a women’s tournament.',
          409,
          'TEAM_DIVISION_MISMATCH',
          { tournamentDivision: CompetitionDivision.WOMEN, teamDivision: resolveCompetitionDivision(team.division) }
        );
      }

      const activeEntries = await TournamentEntry.find({
        tournamentId,
        status: TournamentEntryStatus.ACTIVE,
        isDeleted: false,
      })
        .select('groupSlot')
        .session(session)
        .lean();
      if (activeEntries.length >= 3) {
        throw new CompetitionError(
          'This women’s tournament already has its maximum three teams.',
          409,
          'ENTRY_LIMIT_REACHED'
        );
      }
      const usedSlots = new Set(activeEntries.map((entry) => entry.groupSlot));
      const tableSlot = [1, 2, 3].find((slot) => !usedSlots.has(slot))!;
      const docs = await TournamentEntry.create(
        [
          {
            tournamentId,
            teamId,
            status: TournamentEntryStatus.ACTIVE,
            source: TournamentEntrySource.ADMIN,
            groupKey: 'A',
            groupSlot: tableSlot,
            teamNameSnapshot: team.name,
            teamLogoSnapshot: team.logo,
            createdBy: adminId,
          },
        ],
        { session }
      );
      const {
        groupKey: _groupKey,
        groupSlot,
        ...entry
      } = docs[0].toObject();
      created = { ...entry, tableSlot: groupSlot };
      const updated = await updateWomensTournamentWithRevision(
        tournamentId,
        expectedRevision,
        {
          workflowState:
            activeEntries.length + 1 === 3
              ? CompetitionWorkflowState.ENTRIES_READY
              : CompetitionWorkflowState.SETUP,
        },
        session
      );
      workflowRevision = updated.workflowRevision;
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

export const removeWomensEntry = async (
  tournamentId: string,
  entryId: string,
  expectedRevision: number
) => {
  requireObjectId(entryId, 'entry ID');
  const session = await mongoose.startSession();
  try {
    let response: unknown;
    await session.withTransaction(async () => {
      const tournament = await getWomensTournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      if (!EDITABLE_STATES.has(tournament.workflowState)) {
        throw new CompetitionError(
          'Competition entries are locked because fixtures have already been published.',
          409,
          'COMPETITION_SETUP_LOCKED'
        );
      }
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
      if (!entry) {
        throw new CompetitionError('Tournament entry not found', 404, 'ENTRY_NOT_FOUND');
      }
      const updated = await updateWomensTournamentWithRevision(
        tournamentId,
        expectedRevision,
        { workflowState: CompetitionWorkflowState.SETUP },
        session
      );
      response = { entryId, removed: true, workflowRevision: updated.workflowRevision };
    });
    return response;
  } finally {
    await session.endSession();
  }
};

const buildWomensLeaguePlan = async (
  tournamentId: string,
  expectedRevision: number,
  fixtures: WomensLeagueFixtureInput[],
  sourceReference?: string,
  session?: ClientSession
): Promise<WomensLeaguePlan> => {
  const tournament = await getWomensTournament(tournamentId, session);
  assertExpectedRevision(tournament.workflowRevision, expectedRevision);
  assertWomensRules(tournament.competitionRules!);
  if (tournament.workflowState !== CompetitionWorkflowState.ENTRIES_READY) {
    throw new CompetitionError(
      'Enter exactly three women’s teams before validating league fixtures.',
      409,
      'WOMENS_ENTRIES_NOT_READY'
    );
  }
  const entryQuery = TournamentEntry.find({
    tournamentId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  })
    .sort({ groupSlot: 1 })
    .lean();
  const venueQuery = Venue.find({ isDeleted: false }).sort({ importance: 1, name: 1 }).lean();
  if (session) {
    entryQuery.session(session);
    venueQuery.session(session);
  }
  const entries = await entryQuery;
  const venues = await venueQuery;
  const teamQuery = Team.find({
    _id: { $in: entries.map((entry) => entry.teamId) },
    isDeleted: false,
  })
    .select('name logo division registrationStatus')
    .lean();
  if (session) teamQuery.session(session);
  const teams = await teamQuery;
  const teamById = new Map(teams.map((team) => [team._id.toString(), team]));
  if (
    entries.length !== 3 ||
    teams.length !== 3 ||
    teams.some(
      (team) =>
        team.registrationStatus !== 'registered' ||
        resolveCompetitionDivision(team.division) !== CompetitionDivision.WOMEN
    )
  ) {
    throw new CompetitionError(
      'All three entries must remain registered women’s teams.',
      409,
      'WOMENS_ENTRY_TEAM_INVALID'
    );
  }

  let core;
  try {
    core = buildWomensLeagueFixturePlanCore(
      tournamentId,
      fixtures,
      entries.map((entry) => {
        const team = teamById.get(entry.teamId.toString())!;
        const identity = selectCompetitionTeamIdentity(
          { name: entry.teamNameSnapshot, logo: entry.teamLogoSnapshot },
          team,
          false
        );
        return {
          entryId: entry._id.toString(),
          teamId: entry.teamId.toString(),
          teamName: identity.name,
        };
      }),
      venues.map((venue) => venue.name),
      WOMENS_TIME_ZONE
    );
  } catch (error) {
    if (error instanceof WomensCompetitionPlanError) {
      throw new CompetitionError(error.message, 422, error.code, error.details);
    }
    throw error;
  }
  const unhashed = {
    tournamentId,
    tournamentRevision: tournament.workflowRevision,
    format: TournamentFormat.SINGLE_TABLE_FINAL as const,
    division: CompetitionDivision.WOMEN as const,
    stage: MatchStage.LEAGUE as const,
    timeZone: WOMENS_TIME_ZONE,
    sourceReference: sourceReference?.trim() ?? null,
    totalMatches: core.totalMatches,
    confirmedCount: core.confirmedCount,
    pendingCount: core.pendingCount,
    fixtures: core.fixtures,
  };
  return { ...unhashed, planHash: hashValue(unhashed) };
};

export const previewWomensLeagueFixtures = (
  tournamentId: string,
  input: {
    expectedRevision: number;
    sourceReference?: string;
    fixtures: WomensLeagueFixtureInput[];
  }
) =>
  buildWomensLeaguePlan(
    tournamentId,
    input.expectedRevision,
    input.fixtures,
    input.sourceReference
  );

export const publishWomensLeagueFixtures = (
  tournamentId: string,
  input: {
    expectedRevision: number;
    sourceReference?: string;
    fixtures: WomensLeagueFixtureInput[];
    planHash: string;
  },
  adminId?: string,
  idempotencyKey?: string
) =>
  runIdempotentTransaction(
    tournamentId,
    'publish_womens_league_fixtures',
    idempotencyKey,
    input,
    async (session) => {
      const plan = await buildWomensLeaguePlan(
        tournamentId,
        input.expectedRevision,
        input.fixtures,
        input.sourceReference,
        session
      );
      if (plan.planHash !== input.planHash.toLowerCase()) {
        throw new CompetitionError(
          'Official fixture inputs changed after validation. Validate the plan again before publishing.',
          409,
          'FIXTURE_PLAN_CHANGED'
        );
      }
      await fenceWomensVenueNames(
        plan.fixtures.flatMap((fixture) => (fixture.venue ? [fixture.venue] : [])),
        session
      );
      await assertNoExistingScheduleCollisions(plan.fixtures, session);

      // MongoDB transaction sessions must not execute operations in parallel.
      const resourceChecks = [
        await Match.exists({ tournamentId }).session(session),
        await Standings.exists({ tournamentId }).session(session),
        await TournamentRosterEntry.exists({ tournamentId }).session(session),
        await CompetitionDraw.exists({ tournamentId }).session(session),
        await CompetitionBracket.exists({ tournamentId }).session(session),
        await WomensCompetitionFinal.exists({ tournamentId }).session(session),
        await PlayerStats.exists({ tournamentId }).session(session),
      ];
      if (resourceChecks.some(Boolean)) {
        throw new CompetitionError(
          'The first official fixture publication requires an empty women’s competition state.',
          409,
          'OFFICIAL_PUBLICATION_TARGET_NOT_EMPTY'
        );
      }

      const entries = await TournamentEntry.find({
        tournamentId,
        status: TournamentEntryStatus.ACTIVE,
        isDeleted: false,
      })
        .sort({ groupSlot: 1 })
        .session(session)
        .lean();
      const teamIds = [...new Set(entries.map((entry) => entry.teamId.toString()))];
      if (teamIds.length !== 3) {
        throw new CompetitionError(
          'Exactly three distinct women’s teams are required before publication.',
          409,
          'WOMENS_ENTRY_COUNT_INVALID'
        );
      }
      const fencedTeams = await fenceTeamLifecycles(teamIds, session, {
        registrationStatus: 'registered',
      });
      const invalidTeamIds = [...fencedTeams.entries()]
        .filter(
          ([, team]) =>
            !team || resolveCompetitionDivision(team.division) !== CompetitionDivision.WOMEN
        )
        .map(([teamId]) => teamId);
      if (invalidTeamIds.length > 0) {
        throw new CompetitionError(
          'Every entry must remain an available registered women’s team.',
          409,
          'WOMENS_ENTERED_TEAM_UNAVAILABLE',
          { teamIds: invalidTeamIds }
        );
      }

      const rosterPlayers = await Player.find({ teamId: { $in: teamIds }, isDeleted: false })
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
        FIXED_WOMENS_COMPETITION_RULES.maxRosterPlayers
      );
      if (rosterViolations.length > 0) {
        throw new CompetitionError(
          'One or more women’s teams exceed the maximum 10-player tournament roster.',
          409,
          'ROSTER_LIMIT_EXCEEDED',
          rosterViolations
        );
      }

      const publishedAt = new Date();
      await Match.insertMany(
        plan.fixtures.map((fixture) => ({
          tournamentId,
          homeTeam: fixture.homeTeamId,
          awayTeam: fixture.awayTeamId,
          date: fixture.kickoffAt ? new Date(fixture.kickoffAt) : undefined,
          venue: fixture.venue ?? undefined,
          scheduleStatus: fixture.scheduleStatus,
          stage: MatchStage.LEAGUE,
          status: MatchStatus.SCHEDULED,
          round: fixture.officialNumber,
          leg: 1,
          fixtureKey: fixture.fixtureKey,
          officialFixtureNumber: fixture.officialNumber,
          fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
          fixturePublicationHash: plan.planHash,
          fixtureSourceReference: plan.sourceReference ?? undefined,
          fixturePublishedBy: adminId,
          fixturePublishedAt: publishedAt,
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
        const rosterFence = await Player.bulkWrite(
          rosterPlayers.map((player) => ({
            updateOne: {
              filter: {
                _id: player._id,
                teamId: player.teamId,
                isDeleted: false,
                $or:
                  (player.competitionRosterRevision ?? 0) === 0
                    ? [
                        { competitionRosterRevision: 0 },
                        { competitionRosterRevision: { $exists: false } },
                      ]
                    : [{ competitionRosterRevision: player.competitionRosterRevision }],
              },
              update: { $inc: { competitionRosterRevision: 1 } },
            },
          })),
          { session }
        );
        if (rosterFence.modifiedCount !== rosterPlayers.length) {
          throw new CompetitionError(
            'A player changed while the women’s tournament roster was being captured.',
            409,
            'ROSTER_SNAPSHOT_CONFLICT'
          );
        }
        await TournamentRosterEntry.insertMany(rosterRows, { session, ordered: true });
      }
      await Standings.insertMany(
        entries.map((entry) => ({
          tournamentId,
          tournamentEntryId: entry._id,
          teamId: entry.teamId,
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

      const tournament = await getWomensTournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, input.expectedRevision);
      const updated = await updateWomensTournamentWithRevision(
        tournamentId,
        input.expectedRevision,
        {
          workflowState: CompetitionWorkflowState.GROUP_STAGE,
          currentStage: MatchStage.LEAGUE,
          fixturesGenerated: true,
          leagueRounds: 3,
          status:
            tournament.startDate.getTime() <= publishedAt.getTime()
              ? TournamentStatus.ONGOING
              : TournamentStatus.UPCOMING,
          standingsRevision: input.expectedRevision + 1,
        },
        session,
        { scheduleChanged: true }
      );
      return {
        tournamentId,
        workflowRevision: updated.workflowRevision,
        fixtureCount: 3,
        confirmedCount: plan.confirmedCount,
        pendingCount: plan.pendingCount,
        rosterPlayerCount: rosterRows.length,
        planHash: plan.planHash,
      };
    }
  );

export const getPublishedWomensLeaguePlan = async (tournamentId: string) => {
  const tournament = await getWomensTournament(tournamentId);
  const matches = await Match.find({
    tournamentId,
    stage: MatchStage.LEAGUE,
    isDeleted: false,
  })
    .sort({ officialFixtureNumber: 1, _id: 1 })
    .lean();
  if (matches.length === 0) {
    return {
      status: 'not_published' as const,
      tournamentId,
      tournamentRevision: tournament.workflowRevision,
      format: TournamentFormat.SINGLE_TABLE_FINAL,
      division: CompetitionDivision.WOMEN,
      stage: MatchStage.LEAGUE,
      timeZone: WOMENS_TIME_ZONE,
      sourceReference: null,
      totalMatches: 0,
      confirmedCount: 0,
      pendingCount: 0,
      fixtures: [],
      planHash: null,
    };
  }
  if (matches.length !== 3) {
    throw new CompetitionError(
      'The persisted women’s league publication is incomplete.',
      409,
      'PERSISTED_WOMENS_FIXTURE_COUNT_INVALID',
      { expected: 3, actual: matches.length }
    );
  }
  const entries = await TournamentEntry.find({
    tournamentId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  }).lean();
  const teams = await Team.find({
    _id: { $in: entries.map((entry) => entry.teamId) },
    isDeleted: false,
  })
    .select('name logo')
    .lean();
  const activeVenues = await Venue.find({ isDeleted: false }).select('name').lean();
  const teamById = new Map(teams.map((team) => [team._id.toString(), team]));
  const entryByTeamId = new Map(entries.map((entry) => [entry.teamId.toString(), entry]));
  const fixtures = matches.map((match) => {
    const homeEntry = entryByTeamId.get(match.homeTeam.toString());
    const awayEntry = entryByTeamId.get(match.awayTeam.toString());
    if (
      !homeEntry ||
      !awayEntry ||
      !match.officialFixtureNumber ||
      !match.fixtureKey ||
      !match.fixturePublicationHash ||
      match.fixtureSource !== MatchFixtureSource.PHYSICAL_OFFICIAL ||
      match.leg !== 1 ||
      match.fixtureKey !== `${tournamentId}:league:official:${match.officialFixtureNumber}`
    ) {
      throw new CompetitionError(
        'The persisted women’s fixture publication has invalid identity metadata.',
        409,
        'PERSISTED_WOMENS_FIXTURE_INVALID',
        { matchId: match._id.toString() }
      );
    }
    const historical = tournament.workflowState === CompetitionWorkflowState.COMPLETED;
    const homeIdentity = selectCompetitionTeamIdentity(
      { name: homeEntry.teamNameSnapshot, logo: homeEntry.teamLogoSnapshot },
      teamById.get(homeEntry.teamId.toString()),
      historical
    );
    const awayIdentity = selectCompetitionTeamIdentity(
      { name: awayEntry.teamNameSnapshot, logo: awayEntry.teamLogoSnapshot },
      teamById.get(awayEntry.teamId.toString()),
      historical
    );
    return {
      matchId: match._id.toString(),
      fixtureKey: match.fixtureKey,
      officialNumber: match.officialFixtureNumber,
      leg: 1 as const,
      homeEntryId: homeEntry._id.toString(),
      awayEntryId: awayEntry._id.toString(),
      homeTeamId: homeEntry.teamId.toString(),
      awayTeamId: awayEntry.teamId.toString(),
      homeTeamName: homeIdentity.name,
      awayTeamName: awayIdentity.name,
      kickoffAt: match.date?.toISOString() ?? null,
      venue: match.venue ?? null,
      scheduleStatus: match.scheduleStatus,
    };
  });
  try {
    const normalized = buildWomensLeagueFixturePlanCore(
      tournamentId,
      fixtures.map((fixture) => ({
        officialNumber: fixture.officialNumber,
        homeEntryId: fixture.homeEntryId,
        awayEntryId: fixture.awayEntryId,
        kickoffAt: fixture.kickoffAt,
        venue: fixture.venue,
      })),
      entries.map((entry) => ({
        entryId: entry._id.toString(),
        teamId: entry.teamId.toString(),
        teamName: entry.teamNameSnapshot,
      })),
      activeVenues.map((venue) => venue.name),
      WOMENS_TIME_ZONE
    );
    if (
      normalized.fixtures.some(
        (fixture, index) =>
          fixture.fixtureKey !== fixtures[index].fixtureKey ||
          fixture.scheduleStatus !== fixtures[index].scheduleStatus
      )
    ) {
      throw new CompetitionError(
        'The persisted women’s fixtures have inconsistent schedule metadata.',
        409,
        'PERSISTED_WOMENS_FIXTURE_SCHEDULE_INVALID'
      );
    }
  } catch (error) {
    if (error instanceof WomensCompetitionPlanError) {
      throw new CompetitionError(error.message, 409, error.code, error.details);
    }
    throw error;
  }
  const hashes = new Set(matches.map((match) => match.fixturePublicationHash));
  if (hashes.size !== 1) {
    throw new CompetitionError(
      'The persisted women’s fixtures do not belong to one official publication.',
      409,
      'WOMENS_PUBLICATION_MISMATCH'
    );
  }
  const confirmedCount = fixtures.filter(
    (fixture) => fixture.scheduleStatus === MatchScheduleStatus.CONFIRMED
  ).length;
  return {
    status: 'published' as const,
    tournamentId,
    tournamentRevision: tournament.workflowRevision,
    format: TournamentFormat.SINGLE_TABLE_FINAL,
    division: CompetitionDivision.WOMEN,
    stage: MatchStage.LEAGUE,
    timeZone: WOMENS_TIME_ZONE,
    sourceReference:
      [...new Set(matches.map((match) => match.fixtureSourceReference ?? null))].length === 1
        ? matches[0].fixtureSourceReference ?? null
        : null,
    totalMatches: 3 as const,
    confirmedCount,
    pendingCount: 3 - confirmedCount,
    fixtures,
    planHash: [...hashes][0],
  };
};

const calculateWomensRankingStateInternal = async (
  tournamentId: string,
  session?: ClientSession,
  options: { ignoreStoredResolutions?: boolean } = {}
) => {
  const tournament = await getWomensTournament(tournamentId, session);
  const entryQuery = TournamentEntry.find({
    tournamentId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  })
    .sort({ groupSlot: 1 })
    .lean();
  const matchQuery = Match.find({
    tournamentId,
    stage: MatchStage.LEAGUE,
    isDeleted: false,
  }).lean();
  if (session) {
    entryQuery.session(session);
    matchQuery.session(session);
  }
  const entries = await entryQuery;
  const matches = await matchQuery;
  const teamQuery = Team.find({ _id: { $in: entries.map((entry) => entry.teamId) } })
    .select('name logo')
    .lean();
  if (session) teamQuery.session(session);
  const teams = await teamQuery;
  const teamById = new Map(teams.map((team) => [team._id.toString(), team]));
  const historical = tournament.workflowState === CompetitionWorkflowState.COMPLETED;
  const rowByTeamId = new Map<string, Omit<WomensStandingRow, 'rank'>>();
  for (const entry of entries) {
    const identity = selectCompetitionTeamIdentity(
      { name: entry.teamNameSnapshot, logo: entry.teamLogoSnapshot },
      teamById.get(entry.teamId.toString()),
      historical
    );
    rowByTeamId.set(entry.teamId.toString(), {
      tournamentEntryId: entry._id.toString(),
      tableSlot: entry.groupSlot ?? 0,
      teamId: { _id: entry.teamId.toString(), name: identity.name, logo: identity.logo },
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
  const completed = matches.filter((match) => match.status === MatchStatus.COMPLETED);
  for (const match of completed) {
    const home = rowByTeamId.get(match.homeTeam.toString());
    const away = rowByTeamId.get(match.awayTeam.toString());
    if (!home || !away) {
      throw new CompetitionError(
        'A women’s league match references a team outside the tournament table.',
        409,
        'INVALID_WOMENS_LEAGUE_MATCH',
        { matchId: match._id.toString() }
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

  const resolutionHistory = (tournament.competitionTieResolutions ?? []).map(
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
  const activeResolutionDocuments = selectActiveCommitteeResolutions(resolutionHistory).map(
    (item) => item.resolution
  );
  const storedResolutions: CommitteeResolutionLike[] = options.ignoreStoredResolutions
    ? []
    : activeResolutionDocuments.map((resolution) => ({
        groupKey: 'A',
        basisHash: resolution.basisHash,
        tiedTeamIds: resolution.tiedTeamIds.map((teamId) => teamId.toString()),
        orderedTeamIds: resolution.orderedTeamIds.map((teamId) => teamId.toString()),
        method: resolution.method,
        note: resolution.note,
        decidedAt: resolution.decidedAt,
      }));
  const ranked = rankFixedCompetitionGroup([...rowByTeamId.values()], {
    groupKey: 'A',
    teamIdOf: (row) => row.teamId._id,
    matches: completed.map((match) => ({
      homeTeamId: match.homeTeam.toString(),
      awayTeamId: match.awayTeam.toString(),
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      fixtureKey: match.fixtureKey,
    })),
    resolutions: storedResolutions,
    qualifiersPerGroup: 2,
  });
  const table = ranked.rows as WomensStandingRow[];
  const ties = ranked.ties.map(({ groupKey: _groupKey, ...tie }) => ({
    ...tie,
    scope: 'table' as const,
  }));
  const unresolvedTies = ties.filter((tie) => !tie.resolved);
  const currentBasisHashes = new Set(ties.map((tie) => tie.basisHash));
  const staleResolutionBasisHashes = [
    ...new Set(
      activeResolutionDocuments
        .map((resolution) => resolution.basisHash)
        .filter((basisHash) => !currentBasisHashes.has(basisHash))
    ),
  ];
  const leagueComplete =
    matches.length === 3 &&
    matches.every(
      (match) =>
        match.status === MatchStatus.COMPLETED &&
        match.scheduleStatus === MatchScheduleStatus.CONFIRMED &&
        Boolean(match.date) &&
        Boolean(match.venue)
    );
  return {
    table,
    ties,
    unresolvedTies,
    staleResolutionBasisHashes,
    leagueComplete,
    canFinalizeQualification:
      leagueComplete &&
      !unresolvedTies.some((tie) => tie.affectsQualificationOrSeeding),
  };
};

export const getWomensRankingState = async (tournamentId: string) => {
  const tournament = await getWomensTournament(tournamentId);
  const ranking = await calculateWomensRankingStateInternal(tournamentId);
  const resolutionHistory = (tournament.competitionTieResolutions ?? [])
    .map((resolution, index) => ({
      decisionId: resolution.decisionId?.toString() ?? `legacy-${index}`,
      decisionRevision: resolution.decisionRevision ?? index + 1,
      status: resolution.status ?? CompetitionTieResolutionStatus.ACTIVE,
      scope: 'table' as const,
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
    scope: 'table' as const,
    rankingOrder: WOMENS_FORMAT_POLICY.rankingOrder,
    headToHeadPolicy: WOMENS_FORMAT_POLICY.headToHeadPolicy,
    resolutionHistory,
    ...ranking,
  };
};

export const calculateWomensStandings = async (tournamentId: string) =>
  (await calculateWomensRankingStateInternal(tournamentId)).table;

const persistWomensStandingRows = async (
  tournamentId: string,
  rows: WomensStandingRow[],
  revision: number,
  session: ClientSession
): Promise<void> => {
  const persistenceRows = buildStandingRankPersistenceRows(rows, (row) => row.teamId._id);
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
          $unset: { groupKey: 1 },
        },
        upsert: true,
      },
    })),
    { session }
  );
};

export const recalculateWomensStandingsInSession = async (
  tournamentId: string,
  session: ClientSession
) => {
  const tournament = await getWomensTournament(tournamentId, session);
  const revision = nextStandingsRevision(
    tournament.standingsRevision,
    tournament.workflowRevision
  );
  const fenced = await Tournament.findOneAndUpdate(
    {
      _id: tournamentId,
      formatVersion: 3,
      format: TournamentFormat.SINGLE_TABLE_FINAL,
      division: CompetitionDivision.WOMEN,
      isDeleted: false,
    },
    { $set: { standingsRevision: revision } },
    { new: true, session }
  );
  if (!fenced) {
    throw new CompetitionError(
      'Women’s tournament standings changed during recalculation.',
      409,
      'STANDINGS_REBUILD_CONFLICT'
    );
  }
  const ranking = await calculateWomensRankingStateInternal(tournamentId, session);
  await persistWomensStandingRows(tournamentId, ranking.table, revision, session);
  const statMatches = await Match.find({ tournamentId, isDeleted: false })
    .select('status events')
    .session(session)
    .lean();
  await persistCompetitionPlayerStats(tournamentId, statMatches, revision, session);
  return ranking.table;
};

export const resolveWomensTableTie = async (
  tournamentId: string,
  input: {
    expectedRevision: number;
    basisHash: string;
    orderedTeamIds: string[];
    method: CompetitionCommitteeDecisionMethod;
    note?: string;
  },
  adminId?: string
) => {
  const session = await mongoose.startSession();
  let response: unknown;
  try {
    await session.withTransaction(async () => {
      const tournament = await getWomensTournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, input.expectedRevision);
      if (tournament.workflowState !== CompetitionWorkflowState.GROUP_STAGE) {
        throw new CompetitionError(
          'Table tie decisions can be recorded only after the league and before qualification.',
          409,
          'TIE_RESOLUTION_LOCKED'
        );
      }
      const rawRanking = await calculateWomensRankingStateInternal(tournamentId, session, {
        ignoreStoredResolutions: true,
      });
      if (!rawRanking.leagueComplete) {
        throw new CompetitionError(
          'Complete all three league matches before recording a committee tie decision.',
          409,
          'WOMENS_LEAGUE_INCOMPLETE'
        );
      }
      const tie = rawRanking.unresolvedTies.find(
        (candidate) => candidate.basisHash === input.basisHash.toLowerCase()
      );
      if (!tie) {
        throw new CompetitionError(
          'This tie no longer matches the completed league results. Refresh the table.',
          409,
          'STALE_TIE_BASIS'
        );
      }
      for (const teamId of input.orderedTeamIds) requireObjectId(teamId, 'team ID');
      const orderedTeamIds = input.orderedTeamIds.map((teamId) =>
        new Types.ObjectId(teamId).toString()
      );
      const requested = new Set(orderedTeamIds);
      if (
        requested.size !== tie.teamIds.length ||
        orderedTeamIds.length !== tie.teamIds.length ||
        tie.teamIds.some((teamId) => !requested.has(teamId))
      ) {
        throw new CompetitionError(
          'orderedTeamIds must contain every tied team exactly once.',
          422,
          'INVALID_COMMITTEE_ORDER',
          { expectedTeamIds: tie.teamIds }
        );
      }
      const decidedAt = new Date();
      const resolution = {
        decisionId: new Types.ObjectId().toString(),
        decisionRevision: input.expectedRevision + 1,
        status: CompetitionTieResolutionStatus.ACTIVE,
        groupKey: 'A' as const,
        basisHash: tie.basisHash,
        tiedTeamIds: tie.teamIds,
        orderedTeamIds,
        method: input.method,
        note: input.note?.trim(),
        decidedBy: adminId,
        decidedAt,
        supersededAt: undefined,
        supersededByDecisionId: undefined,
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
      const updated = await updateWomensTournamentWithRevision(
        tournamentId,
        input.expectedRevision,
        { competitionTieResolutions: resolutionHistory, standingsRevision },
        session
      );
      const ranking = await calculateWomensRankingStateInternal(tournamentId, session);
      await persistWomensStandingRows(tournamentId, ranking.table, standingsRevision, session);
      response = {
        workflowRevision: updated.workflowRevision,
        resolution: {
          decisionId: resolution.decisionId,
          decisionRevision: resolution.decisionRevision,
          status: resolution.status,
          scope: 'table' as const,
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

const assertPersistedWomensLeague = async (
  tournamentId: string,
  session: ClientSession
): Promise<void> => {
  const entries = await TournamentEntry.find({
    tournamentId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  })
    .session(session)
    .lean();
  const matches = await Match.find({
    tournamentId,
    stage: MatchStage.LEAGUE,
    isDeleted: false,
  })
    .session(session)
    .lean();
  if (entries.length !== 3 || matches.length !== 3) {
    throw new CompetitionError(
      'The persisted women’s league must contain exactly three teams and three fixtures.',
      409,
      'PERSISTED_WOMENS_LEAGUE_INVALID'
    );
  }
  if (
    matches.some(
      (match) =>
        match.fixtureSource !== MatchFixtureSource.PHYSICAL_OFFICIAL ||
        match.scheduleStatus !== MatchScheduleStatus.CONFIRMED ||
        !match.date ||
        !match.venue ||
        match.leg !== 1 ||
        !match.officialFixtureNumber ||
        !match.fixturePublicationHash ||
        match.fixtureKey !== `${tournamentId}:league:official:${match.officialFixtureNumber}`
    )
  ) {
    throw new CompetitionError(
      'Every women’s league fixture must have a confirmed physical schedule before qualification.',
      409,
      'WOMENS_LEAGUE_SCHEDULE_INCOMPLETE'
    );
  }
  if (new Set(matches.map((match) => match.fixturePublicationHash)).size !== 1) {
    throw new CompetitionError(
      'The women’s league fixtures do not belong to one official publication.',
      409,
      'WOMENS_PUBLICATION_MISMATCH'
    );
  }
  const entryByTeam = new Map(entries.map((entry) => [entry.teamId.toString(), entry]));
  try {
    buildWomensLeagueFixturePlanCore(
      tournamentId,
      matches.map((match) => {
        const home = entryByTeam.get(match.homeTeam.toString());
        const away = entryByTeam.get(match.awayTeam.toString());
        if (!home || !away) {
          throw new WomensCompetitionPlanError(
            'A persisted fixture references a team outside the women’s table.',
            'PERSISTED_WOMENS_FIXTURE_ENTRY_INVALID',
            { matchId: match._id.toString() }
          );
        }
        return {
          officialNumber: match.officialFixtureNumber!,
          homeEntryId: home._id.toString(),
          awayEntryId: away._id.toString(),
          kickoffAt: match.date!.toISOString(),
          venue: match.venue!,
        };
      }),
      entries.map((entry) => ({
        entryId: entry._id.toString(),
        teamId: entry.teamId.toString(),
        teamName: entry.teamNameSnapshot,
      })),
      [...new Set(matches.map((match) => match.venue!))],
      WOMENS_TIME_ZONE
    );
  } catch (error) {
    if (error instanceof WomensCompetitionPlanError) {
      throw new CompetitionError(error.message, 409, error.code, error.details);
    }
    throw error;
  }
};

export const finalizeWomensQualification = (
  tournamentId: string,
  expectedRevision: number,
  idempotencyKey?: string
) =>
  runIdempotentTransaction(
    tournamentId,
    'finalize_womens_qualification',
    idempotencyKey,
    { expectedRevision },
    async (session) => {
      const tournament = await getWomensTournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      if (tournament.workflowState !== CompetitionWorkflowState.GROUP_STAGE) {
        throw new CompetitionError(
          'Qualification can only be finalized after the women’s league is published.',
          409,
          'INVALID_WORKFLOW_STATE'
        );
      }
      assertWomensRules(tournament.competitionRules!);
      await assertPersistedWomensLeague(tournamentId, session);
      const incomplete = await Match.countDocuments({
        tournamentId,
        stage: MatchStage.LEAGUE,
        isDeleted: false,
        status: { $ne: MatchStatus.COMPLETED },
      }).session(session);
      if (incomplete > 0) {
        throw new CompetitionError(
          'All three women’s league matches must be completed before qualification.',
          409,
          'WOMENS_LEAGUE_INCOMPLETE',
          { incompleteMatches: incomplete }
        );
      }
      const ranking = await calculateWomensRankingStateInternal(tournamentId, session);
      const unresolvedRelevant = ranking.unresolvedTies.filter(
        (tie) => tie.affectsQualificationOrSeeding
      );
      if (unresolvedRelevant.length > 0) {
        throw new CompetitionError(
          'A committee decision is required for each tie affecting the top two or final seeding.',
          409,
          'UNRESOLVED_QUALIFICATION_TIE',
          { unresolvedTies: unresolvedRelevant }
        );
      }
      const lockTime = new Date();
      const locked = await Match.updateMany(
        {
          tournamentId,
          stage: MatchStage.LEAGUE,
          isDeleted: false,
          status: MatchStatus.COMPLETED,
          resultLockedAt: { $exists: false },
        },
        {
          $set: {
            resultLockedAt: lockTime,
            resultLockReason: 'qualification_finalized',
          },
          $inc: { __v: 1 },
        },
        { session }
      );
      if (locked.modifiedCount !== 3) {
        throw new CompetitionError(
          'A women’s league result changed during qualification. Refresh and retry.',
          409,
          'MATCH_RESULT_CONFLICT'
        );
      }
      const qualified = ranking.table.slice(0, 2).map((row) => ({
        tournamentEntryId: row.tournamentEntryId,
        teamId: row.teamId._id,
        groupKey: 'A' as const,
        rank: row.rank,
        points: row.points,
        goalDifference: row.goalDifference,
        goalsFor: row.goalsFor,
      }));
      const standingsRevision = nextStandingsRevision(
        tournament.standingsRevision,
        tournament.workflowRevision
      );
      await persistWomensStandingRows(
        tournamentId,
        ranking.table,
        standingsRevision,
        session
      );
      const updated = await updateWomensTournamentWithRevision(
        tournamentId,
        expectedRevision,
        {
          workflowState: CompetitionWorkflowState.QUALIFICATION_FINALIZED,
          currentStage: MatchStage.FINAL,
          qualificationSnapshot: qualified,
          qualificationFinalizedAt: lockTime,
          standingsRevision,
        },
        session
      );
      return {
        tournamentId,
        workflowRevision: updated.workflowRevision,
        qualified: qualified.map(({ groupKey: _groupKey, ...row }) => ({
          ...row,
          scope: 'table' as const,
        })),
      };
    }
  );

const normalizeFinalSchedule = async (
  kickoffAtInput: string | null,
  venueInput: string | null,
  session?: ClientSession
) => {
  if ((kickoffAtInput === null) !== (venueInput === null)) {
    throw new CompetitionError(
      'kickoffAt and venue must both be set or both be null.',
      422,
      'WOMENS_FINAL_SCHEDULE_INCOMPLETE'
    );
  }
  if (kickoffAtInput === null || venueInput === null) {
    return {
      kickoffAt: null,
      venue: null,
      scheduleStatus: MatchScheduleStatus.PENDING,
    };
  }
  const kickoffAt = new Date(kickoffAtInput);
  if (Number.isNaN(kickoffAt.getTime())) {
    throw new CompetitionError(
      'The women’s final kickoff time is invalid.',
      422,
      'WOMENS_FINAL_KICKOFF_INVALID'
    );
  }
  const venueQuery = Venue.find({ isDeleted: false }).select('name').lean();
  if (session) venueQuery.session(session);
  const venues = await venueQuery;
  const venue = venues.find(
    (candidate) =>
      candidate.name.trim().toLocaleLowerCase() === venueInput.trim().toLocaleLowerCase()
  )?.name;
  if (!venue) {
    throw new CompetitionError(
      'The women’s final must use an active venue.',
      422,
      'WOMENS_FINAL_VENUE_INVALID'
    );
  }
  return {
    kickoffAt: kickoffAt.toISOString(),
    venue,
    scheduleStatus: MatchScheduleStatus.CONFIRMED,
  };
};

const buildWomensFinalPlan = async (
  tournamentId: string,
  expectedRevision: number,
  kickoffAtInput: string | null,
  venueInput: string | null,
  sourceReference?: string,
  session?: ClientSession
): Promise<WomensFinalPlan> => {
  const tournament = await getWomensTournament(tournamentId, session);
  assertExpectedRevision(tournament.workflowRevision, expectedRevision);
  if (tournament.workflowState !== CompetitionWorkflowState.QUALIFICATION_FINALIZED) {
    throw new CompetitionError(
      'Finalize the women’s top two before recording the physical final.',
      409,
      'QUALIFICATION_NOT_FINALIZED'
    );
  }
  const qualifiers = [...tournament.qualificationSnapshot].sort(
    (left, right) => left.rank - right.rank
  );
  if (
    qualifiers.length !== 2 ||
    qualifiers[0].rank !== 1 ||
    qualifiers[1].rank !== 2 ||
    qualifiers[0].teamId.toString() === qualifiers[1].teamId.toString()
  ) {
    throw new CompetitionError(
      'The women’s final requires a valid rank-1 and rank-2 qualification snapshot.',
      409,
      'WOMENS_QUALIFICATION_SNAPSHOT_INVALID'
    );
  }
  const entries = await TournamentEntry.find({
    _id: { $in: qualifiers.map((qualifier) => qualifier.tournamentEntryId) },
    tournamentId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  }).lean();
  if (entries.length !== 2) {
    throw new CompetitionError(
      'A qualified women’s final entry is no longer available.',
      409,
      'WOMENS_FINAL_ENTRY_INVALID'
    );
  }
  const entryById = new Map(entries.map((entry) => [entry._id.toString(), entry]));
  const identities = await readCompetitionTeamIdentitySummaries(
    tournamentId,
    qualifiers.map((qualifier) => qualifier.teamId),
    false,
    session
  );
  const homeEntry = entryById.get(qualifiers[0].tournamentEntryId.toString())!;
  const awayEntry = entryById.get(qualifiers[1].tournamentEntryId.toString())!;
  if (
    homeEntry.teamId.toString() !== qualifiers[0].teamId.toString() ||
    awayEntry.teamId.toString() !== qualifiers[1].teamId.toString()
  ) {
    throw new CompetitionError(
      'The women’s final qualification snapshot no longer matches its entries.',
      409,
      'WOMENS_FINAL_ENTRY_MISMATCH'
    );
  }
  const schedule = await normalizeFinalSchedule(
    kickoffAtInput,
    venueInput,
    session
  );
  const unhashed = {
    tournamentId,
    tournamentRevision: tournament.workflowRevision,
    format: TournamentFormat.SINGLE_TABLE_FINAL as const,
    division: CompetitionDivision.WOMEN as const,
    stage: MatchStage.FINAL as const,
    timeZone: WOMENS_TIME_ZONE,
    sourceReference: sourceReference?.trim() ?? null,
    officialNumber: 4 as const,
    fixtureKey: `${tournamentId}:final:official:4`,
    homeQualificationRank: 1 as const,
    awayQualificationRank: 2 as const,
    homeEntryId: homeEntry._id.toString(),
    awayEntryId: awayEntry._id.toString(),
    homeTeamId: homeEntry.teamId.toString(),
    awayTeamId: awayEntry.teamId.toString(),
    homeTeamName:
      identities.get(homeEntry.teamId.toString())?.name ?? homeEntry.teamNameSnapshot,
    awayTeamName:
      identities.get(awayEntry.teamId.toString())?.name ?? awayEntry.teamNameSnapshot,
    ...schedule,
  };
  return { ...unhashed, planHash: hashValue(unhashed) };
};

export const previewWomensFinal = (
  tournamentId: string,
  input: {
    expectedRevision: number;
    sourceReference?: string;
    kickoffAt: string | null;
    venue: string | null;
  }
) =>
  buildWomensFinalPlan(
    tournamentId,
    input.expectedRevision,
    input.kickoffAt,
    input.venue,
    input.sourceReference
  );

export const publishWomensFinal = (
  tournamentId: string,
  input: {
    expectedRevision: number;
    sourceReference?: string;
    kickoffAt: string | null;
    venue: string | null;
    planHash: string;
  },
  adminId?: string,
  idempotencyKey?: string
) =>
  runIdempotentTransaction(
    tournamentId,
    'publish_womens_final',
    idempotencyKey,
    input,
    async (session) => {
      const plan = await buildWomensFinalPlan(
        tournamentId,
        input.expectedRevision,
        input.kickoffAt,
        input.venue,
        input.sourceReference,
        session
      );
      if (plan.planHash !== input.planHash.toLowerCase()) {
        throw new CompetitionError(
          'The final inputs changed after validation. Validate the plan again before publishing.',
          409,
          'FIXTURE_PLAN_CHANGED'
        );
      }
      await fenceWomensVenueNames(plan.venue ? [plan.venue] : [], session);
      const fencedTeams = await fenceTeamLifecycles(
        [plan.homeTeamId, plan.awayTeamId],
        session,
        { registrationStatus: 'registered' }
      );
      const invalidTeamIds = [...fencedTeams.entries()]
        .filter(
          ([, team]) =>
            !team || resolveCompetitionDivision(team.division) !== CompetitionDivision.WOMEN
        )
        .map(([teamId]) => teamId);
      if (invalidTeamIds.length > 0) {
        throw new CompetitionError(
          'Both qualified teams must remain registered women’s teams.',
          409,
          'WOMENS_FINAL_TEAM_UNAVAILABLE',
          { teamIds: invalidTeamIds }
        );
      }
      await assertNoExistingScheduleCollisions(
        [
          {
            officialNumber: plan.officialNumber,
            homeTeamId: plan.homeTeamId,
            awayTeamId: plan.awayTeamId,
            kickoffAt: plan.kickoffAt,
            venue: plan.venue,
          },
        ],
        session
      );
      if (
        (await WomensCompetitionFinal.exists({ tournamentId }).session(session)) ||
        (await Match.exists({
          tournamentId,
          stage: MatchStage.FINAL,
          isDeleted: false,
        }).session(session))
      ) {
        throw new CompetitionError(
          'The women’s final has already been published.',
          409,
          'WOMENS_FINAL_ALREADY_PUBLISHED'
        );
      }

      const publishedAt = new Date();
      const finalStateId = new Types.ObjectId();
      const matchId = new Types.ObjectId();
      await Match.create(
        [
          {
            _id: matchId,
            tournamentId,
            homeTeam: plan.homeTeamId,
            awayTeam: plan.awayTeamId,
            date: plan.kickoffAt ? new Date(plan.kickoffAt) : undefined,
            venue: plan.venue ?? undefined,
            scheduleStatus: plan.scheduleStatus,
            stage: MatchStage.FINAL,
            status: MatchStatus.SCHEDULED,
            leg: 1,
            fixtureKey: plan.fixtureKey,
            officialFixtureNumber: 4,
            fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
            fixturePublicationHash: plan.planHash,
            fixtureSourceReference: plan.sourceReference ?? undefined,
            fixturePublishedBy: adminId,
            fixturePublishedAt: publishedAt,
            womensFinalId: finalStateId,
            events: [],
          },
        ],
        { session }
      );
      await WomensCompetitionFinal.create(
        [
          {
            _id: finalStateId,
            tournamentId,
            status: WomensFinalStatus.PUBLISHED,
            revision: input.expectedRevision + 1,
            qualificationRevision: input.expectedRevision,
            qualifiers: [
              {
                rank: 1,
                tournamentEntryId: plan.homeEntryId,
                teamId: plan.homeTeamId,
              },
              {
                rank: 2,
                tournamentEntryId: plan.awayEntryId,
                teamId: plan.awayTeamId,
              },
            ],
            matchId,
            planHash: plan.planHash,
            sourceReference: plan.sourceReference ?? undefined,
            publishedBy: adminId,
            publishedAt,
          },
        ],
        { session }
      );
      const updated = await updateWomensTournamentWithRevision(
        tournamentId,
        input.expectedRevision,
        {
          workflowState: CompetitionWorkflowState.KNOCKOUT_STAGE,
          currentStage: MatchStage.FINAL,
          status: TournamentStatus.ONGOING,
        },
        session,
        { scheduleChanged: true }
      );
      return {
        tournamentId,
        workflowRevision: updated.workflowRevision,
        finalStateId: finalStateId.toString(),
        matchId: matchId.toString(),
        planHash: plan.planHash,
        scheduleStatus: plan.scheduleStatus,
      };
    }
  );

interface PersistedWomensFinalInvariantState {
  _id: { toString(): string };
  tournamentId: { toString(): string };
  matchId: { toString(): string };
  qualifiers: Array<{
    rank: number;
    teamId: { toString(): string };
  }>;
  planHash: string;
}

interface PersistedWomensFinalMatchInvariant {
  _id: { toString(): string };
  tournamentId: { toString(): string };
  womensFinalId?: { toString(): string };
  homeTeam: { toString(): string };
  awayTeam: { toString(): string };
  stage: MatchStage;
  leg?: number;
  officialFixtureNumber?: number;
  fixtureKey?: string;
  fixtureSource?: MatchFixtureSource;
  fixturePublicationHash?: string;
  scheduleStatus: MatchScheduleStatus;
  date?: Date;
  venue?: string;
}

const assertPersistedWomensFinalInvariant = (
  tournamentId: string,
  finalState: PersistedWomensFinalInvariantState,
  match: PersistedWomensFinalMatchInvariant
): void => {
  const qualifiers = [...finalState.qualifiers].sort(
    (left, right) => left.rank - right.rank
  );
  const hasConfirmedSchedule =
    match.scheduleStatus === MatchScheduleStatus.CONFIRMED &&
    match.date instanceof Date &&
    Boolean(match.venue?.trim());
  const hasPendingSchedule =
    match.scheduleStatus === MatchScheduleStatus.PENDING &&
    !match.date &&
    !match.venue;
  if (
    finalState.tournamentId.toString() !== tournamentId ||
    match.tournamentId.toString() !== tournamentId ||
    finalState.matchId.toString() !== match._id.toString() ||
    match.womensFinalId?.toString() !== finalState._id.toString() ||
    qualifiers.length !== 2 ||
    qualifiers[0].rank !== 1 ||
    qualifiers[1].rank !== 2 ||
    qualifiers[0].teamId.toString() === qualifiers[1].teamId.toString() ||
    match.homeTeam.toString() !== qualifiers[0].teamId.toString() ||
    match.awayTeam.toString() !== qualifiers[1].teamId.toString() ||
    match.stage !== MatchStage.FINAL ||
    match.leg !== 1 ||
    match.officialFixtureNumber !== 4 ||
    match.fixtureKey !== `${tournamentId}:final:official:4` ||
    match.fixtureSource !== MatchFixtureSource.PHYSICAL_OFFICIAL ||
    match.fixturePublicationHash !== finalState.planHash ||
    (!hasConfirmedSchedule && !hasPendingSchedule)
  ) {
    throw new CompetitionError(
      'The persisted women’s final has invalid qualification, participant, schedule, or provenance linkage.',
      409,
      'PERSISTED_WOMENS_FINAL_INVALID'
    );
  }
};

export const getWomensFinalPlan = async (tournamentId: string) => {
  const tournament = await getWomensTournament(tournamentId);
  const finalState = await WomensCompetitionFinal.findOne({ tournamentId }).lean();
  if (!finalState) {
    return {
      status: 'not_published' as const,
      tournamentId,
      tournamentRevision: tournament.workflowRevision,
      format: TournamentFormat.SINGLE_TABLE_FINAL,
      division: CompetitionDivision.WOMEN,
      stage: MatchStage.FINAL,
      timeZone: WOMENS_TIME_ZONE,
      sourceReference: null,
      finalStateId: null,
      matchId: null,
      officialNumber: null,
      fixtureKey: null,
      homeQualificationRank: null,
      awayQualificationRank: null,
      homeEntryId: null,
      awayEntryId: null,
      homeTeamId: null,
      awayTeamId: null,
      homeTeamName: null,
      awayTeamName: null,
      kickoffAt: null,
      venue: null,
      scheduleStatus: null,
      matchStatus: null,
      winnerTeamId: null,
      fixture: null,
      planHash: null,
    };
  }
  const match = await Match.findOne({
    _id: finalState.matchId,
    tournamentId,
    stage: MatchStage.FINAL,
    womensFinalId: finalState._id,
    isDeleted: false,
  }).lean();
  if (!match) {
    throw new CompetitionError(
      'The persisted women’s final match is missing.',
      409,
      'PERSISTED_WOMENS_FINAL_INVALID'
    );
  }
  assertPersistedWomensFinalInvariant(tournamentId, finalState, match);
  const qualifiers = [...finalState.qualifiers].sort((left, right) => left.rank - right.rank);
  const identities = await readCompetitionTeamIdentitySummaries(
    tournamentId,
    qualifiers.map((qualifier) => qualifier.teamId),
    tournament.workflowState === CompetitionWorkflowState.COMPLETED
  );
  const fixture = {
    matchId: match._id.toString(),
    officialNumber: 4 as const,
    fixtureKey: match.fixtureKey,
    homeQualificationRank: 1 as const,
    awayQualificationRank: 2 as const,
    homeEntryId: qualifiers[0].tournamentEntryId.toString(),
    awayEntryId: qualifiers[1].tournamentEntryId.toString(),
    homeTeamId: qualifiers[0].teamId.toString(),
    awayTeamId: qualifiers[1].teamId.toString(),
    homeTeamName: identities.get(qualifiers[0].teamId.toString())?.name,
    awayTeamName: identities.get(qualifiers[1].teamId.toString())?.name,
    kickoffAt: match.date?.toISOString() ?? null,
    venue: match.venue ?? null,
    scheduleStatus: match.scheduleStatus,
    matchStatus: match.status,
    winnerTeamId: match.winner?.toString() ?? null,
  };
  return {
    status: finalState.status,
    tournamentId,
    tournamentRevision: tournament.workflowRevision,
    format: TournamentFormat.SINGLE_TABLE_FINAL,
    division: CompetitionDivision.WOMEN,
    stage: MatchStage.FINAL,
    timeZone: WOMENS_TIME_ZONE,
    sourceReference: finalState.sourceReference ?? null,
    finalStateId: finalState._id.toString(),
    planHash: finalState.planHash,
    ...fixture,
    fixture,
  };
};

export const getWomensBracketState = async (tournamentId: string) => {
  const plan = await getWomensFinalPlan(tournamentId);
  if (plan.status === 'not_published' || !plan.fixture) {
    return {
      bracketVersion: 3,
      format: TournamentFormat.SINGLE_TABLE_FINAL,
      status: 'not_created',
      finalStateId: null,
      revision: null,
      championTeam: null,
      runnerUpTeam: null,
      thirdPlaceTeam: null,
      stages: { [MatchStage.FINAL]: [] },
    };
  }
  const finalState = await WomensCompetitionFinal.findById(plan.finalStateId).lean();
  const identities = await readCompetitionTeamIdentitySummaries(
    tournamentId,
    [
      plan.fixture.homeTeamId,
      plan.fixture.awayTeamId,
      ...(finalState?.championTeamId ? [finalState.championTeamId] : []),
      ...(finalState?.runnerUpTeamId ? [finalState.runnerUpTeamId] : []),
    ],
    finalState?.status === WomensFinalStatus.CHAMPION_DECIDED
  );
  const summary = (teamId?: Types.ObjectId | string) =>
    teamId ? identities.get(teamId.toString()) ?? { _id: teamId.toString() } : null;
  const match = await Match.findById(plan.fixture.matchId)
    .populate('homeTeam awayTeam winner', 'name logo')
    .lean();
  return {
    bracketVersion: 3,
    format: TournamentFormat.SINGLE_TABLE_FINAL,
    status: finalState?.status ?? WomensFinalStatus.PUBLISHED,
    finalStateId: plan.finalStateId,
    revision: finalState?.revision ?? null,
    championTeam: summary(finalState?.championTeamId),
    runnerUpTeam: summary(finalState?.runnerUpTeamId),
    thirdPlaceTeam: null,
    stages: {
      [MatchStage.FINAL]: [
        {
          key: 'final:1',
          stage: MatchStage.FINAL,
          slot: 1,
          kind: 'championship',
          homeSource: { type: 'qualification_rank', rank: 1 },
          awaySource: { type: 'qualification_rank', rank: 2 },
          homeTeam: summary(plan.fixture.homeTeamId),
          awayTeam: summary(plan.fixture.awayTeamId),
          winnerTeam: summary(finalState?.championTeamId),
          loserTeam: summary(finalState?.runnerUpTeamId),
          resolvedAt: finalState?.championDecidedAt ?? null,
          match,
        },
      ],
    },
  };
};

export const progressWomensFinal = (
  tournamentId: string,
  expectedRevision: number,
  adminId?: string,
  idempotencyKey?: string
) =>
  runIdempotentTransaction(
    tournamentId,
    'progress_womens_final',
    idempotencyKey,
    { expectedRevision, adminId: adminId ?? null },
    async (session) => {
      const tournament = await getWomensTournament(tournamentId, session);
      assertExpectedRevision(tournament.workflowRevision, expectedRevision);
      const finalState = await WomensCompetitionFinal.findOne({ tournamentId }).session(session);
      if (!finalState) {
        throw new CompetitionError(
          'Publish the physical women’s final before completing the competition.',
          409,
          'WOMENS_FINAL_NOT_PUBLISHED'
        );
      }
      if (
        tournament.workflowState === CompetitionWorkflowState.COMPLETED &&
        finalState.status === WomensFinalStatus.CHAMPION_DECIDED &&
        finalState.championTeamId &&
        finalState.runnerUpTeamId
      ) {
        return {
          action: 'already_completed' as const,
          tournamentId,
          workflowRevision: tournament.workflowRevision,
          championTeamId: finalState.championTeamId.toString(),
          runnerUpTeamId: finalState.runnerUpTeamId.toString(),
        };
      }
      if (
        tournament.workflowState !== CompetitionWorkflowState.KNOCKOUT_STAGE ||
        finalState.status !== WomensFinalStatus.PUBLISHED ||
        finalState.revision !== expectedRevision
      ) {
        throw new CompetitionError(
          'The women’s final is not ready to complete.',
          409,
          'INVALID_WORKFLOW_STATE'
        );
      }
      const match = await Match.findOne({
        _id: finalState.matchId,
        tournamentId,
        stage: MatchStage.FINAL,
        womensFinalId: finalState._id,
        isDeleted: false,
      }).session(session);
      if (!match) {
        throw new CompetitionError(
          'The durable women’s final match is missing.',
          409,
          'WOMENS_FINAL_MATCH_MISSING'
        );
      }
      assertPersistedWomensFinalInvariant(tournamentId, finalState, match);
      if (
        match.status !== MatchStatus.COMPLETED ||
        match.scheduleStatus !== MatchScheduleStatus.CONFIRMED ||
        !match.date ||
        !match.venue ||
        !isValidKnockoutScoreWinner({
          homeTeamId: match.homeTeam.toString(),
          awayTeamId: match.awayTeam.toString(),
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          winnerTeamId: match.winner?.toString(),
          shootoutScore: match.shootoutScore,
        })
      ) {
        throw new CompetitionError(
          'Complete the confirmed physical final with a validated winner before progressing.',
          409,
          'WOMENS_FINAL_RESULT_INCOMPLETE'
        );
      }
      const winnerTeamId = match.winner!;
      const runnerUpTeamId =
        winnerTeamId.toString() === match.homeTeam.toString()
          ? match.awayTeam
          : match.homeTeam;
      const decidedAt = new Date();
      match.resultLockedAt = decidedAt;
      match.resultLockReason = 'competition_completed';
      await match.save({ session });

      finalState.status = WomensFinalStatus.CHAMPION_DECIDED;
      finalState.championTeamId = winnerTeamId;
      finalState.runnerUpTeamId = runnerUpTeamId;
      finalState.championDecidedAt = decidedAt;
      finalState.revision = expectedRevision + 1;
      await finalState.save({ session });

      const updated = await updateWomensTournamentWithRevision(
        tournamentId,
        expectedRevision,
        {
          workflowState: CompetitionWorkflowState.COMPLETED,
          currentStage: MatchStage.FINAL,
          status: TournamentStatus.COMPLETED,
          championTeamId: winnerTeamId,
          runnerUpTeamId,
          competitionCompletedAt: decidedAt,
        },
        session
      );
      return {
        action: 'competition_completed' as const,
        tournamentId,
        workflowRevision: updated.workflowRevision,
        championTeamId: winnerTeamId.toString(),
        runnerUpTeamId: runnerUpTeamId.toString(),
      };
    }
  );

export const getWomensOverview = async (tournamentId: string) => {
  const tournament = await getWomensTournament(tournamentId);
  assertWomensRules(tournament.competitionRules!);
  const [entries, venueCount, matchCounts, finalPlan] = await Promise.all([
    TournamentEntry.find({
      tournamentId,
      status: TournamentEntryStatus.ACTIVE,
      isDeleted: false,
    })
      .sort({ groupSlot: 1 })
      .lean(),
    Venue.countDocuments({ isDeleted: false }),
    Match.aggregate([
      {
        $match: {
          tournamentId: new Types.ObjectId(tournamentId),
          stage: MatchStage.LEAGUE,
          isDeleted: false,
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    getWomensFinalPlan(tournamentId),
  ]);
  const teams = await Team.find({
    _id: { $in: entries.map((entry) => entry.teamId) },
    isDeleted: false,
  })
    .select('name logo city registrationStatus division')
    .lean();
  const teamById = new Map(teams.map((team) => [team._id.toString(), team]));
  const historical = tournament.workflowState === CompetitionWorkflowState.COMPLETED;
  const overviewEntries = entries.map((entry) => {
    const team = teamById.get(entry.teamId.toString());
    const identity = selectCompetitionTeamIdentity(
      { name: entry.teamNameSnapshot, logo: entry.teamLogoSnapshot },
      team,
      historical
    );
    return {
      _id: entry._id,
      tournamentId: entry.tournamentId,
      teamId: {
        _id: entry.teamId,
        city: team?.city,
        registrationStatus: team?.registrationStatus,
        division: resolveCompetitionDivision(team?.division),
        ...identity,
      },
      status: entry.status,
      source: entry.source,
      tableSlot: entry.groupSlot,
    };
  });
  const blockers: string[] = [];
  if (entries.length !== 3) blockers.push('Exactly three active women’s teams are required.');
  if (
    teams.length !== entries.length ||
    teams.some(
      (team) =>
        team.registrationStatus !== 'registered' ||
        resolveCompetitionDivision(team.division) !== CompetitionDivision.WOMEN
    )
  ) {
    blockers.push('Every entry must remain a registered women’s team.');
  }
  const ranking = tournament.fixturesGenerated
    ? await getWomensRankingState(tournamentId)
    : null;
  const matchStatusCounts = Object.fromEntries(
    matchCounts.map((item: { _id: string; count: number }) => [item._id, item.count])
  );
  const finalReady =
    finalPlan.status !== 'not_published' &&
    finalPlan.fixture?.matchStatus === MatchStatus.COMPLETED &&
    Boolean(finalPlan.fixture.winnerTeamId);
  const rawTournament = tournament.toObject();
  const sanitizedTournament = {
    ...rawTournament,
    division: CompetitionDivision.WOMEN,
    qualificationSnapshot: (rawTournament.qualificationSnapshot ?? []).map(
      ({ groupKey: _groupKey, ...snapshot }) => ({
        ...snapshot,
        scope: 'table' as const,
      })
    ),
    competitionTieResolutions: (rawTournament.competitionTieResolutions ?? []).map(
      ({ groupKey: _groupKey, ...resolution }) => ({
        ...resolution,
        scope: 'table' as const,
      })
    ),
  };
  delete (sanitizedTournament as Record<string, unknown>).scheduleRevision;
  delete (sanitizedTournament as Record<string, unknown>).rosterIdentityRevision;
  return {
    tournament: sanitizedTournament,
    entries: overviewEntries,
    formatPolicy: WOMENS_FORMAT_POLICY,
    capabilities: {
      usesGroups: false,
      manualGroupAssignment: false,
      physicalLeagueFixtures: true,
      randomFixtureGeneration: false,
      qualifiesToFinal: true,
      physicalFinal: true,
      knockoutDraw: false,
      semifinals: false,
      thirdPlace: false,
    },
    readiness: {
      isReadyForFixturePreview:
        tournament.workflowState === CompetitionWorkflowState.ENTRIES_READY &&
        blockers.length === 0,
      blockers,
      entryCount: entries.length,
      requiredEntryCount: 3,
      venueCount,
    },
    progress: {
      workflowState: tournament.workflowState,
      workflowRevision: tournament.workflowRevision,
      leagueMatches: matchStatusCounts,
      ranking,
      final: finalPlan,
    },
    allowedActions: {
      editRules: false,
      editEntries: EDITABLE_STATES.has(tournament.workflowState),
      assignGroups: false,
      previewFixtures:
        tournament.workflowState === CompetitionWorkflowState.ENTRIES_READY &&
        blockers.length === 0,
      publishFixtures:
        tournament.workflowState === CompetitionWorkflowState.ENTRIES_READY &&
        blockers.length === 0,
      resolveTie:
        tournament.workflowState === CompetitionWorkflowState.GROUP_STAGE &&
        ranking?.leagueComplete === true &&
        (ranking.unresolvedTies?.length ?? 0) > 0,
      finalizeQualification:
        tournament.workflowState === CompetitionWorkflowState.GROUP_STAGE &&
        ranking?.canFinalizeQualification === true,
      previewFinal:
        tournament.workflowState === CompetitionWorkflowState.QUALIFICATION_FINALIZED,
      publishFinal:
        tournament.workflowState === CompetitionWorkflowState.QUALIFICATION_FINALIZED,
      progressFinal:
        tournament.workflowState === CompetitionWorkflowState.KNOCKOUT_STAGE && finalReady,
    },
  };
};
