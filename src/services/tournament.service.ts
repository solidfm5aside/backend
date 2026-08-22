import Tournament, {
  CompetitionTieBreaker,
  CompetitionWorkflowState,
  FIXED_V2_COMPETITION_RULES,
  FIXED_WOMENS_COMPETITION_RULES,
  TournamentFormat,
  TournamentStatus,
} from '@/models/tournament.model';
import {
  CompetitionDivision,
  competitionDivisionFilter,
  resolveCompetitionDivision,
} from '@/models/competition-division';
import Team from '@/models/team.model';
import Match, { MatchStage } from '@/models/match.model';
import Standings from '@/models/standings.model';
import TournamentEntry from '@/models/tournament-entry.model';
import { getCompetitionBracketState } from './competition.service';
import { getWomensBracketState } from './womens-competition.service';
import {
  isTournamentDateRangeValid,
  TournamentDateChanges,
} from '@/utils/tournament-metadata.util';
import {
  applyTeamIdentitySnapshot,
  buildCompetitionIdentitySnapshotMap,
  competitionIdentityKey,
  competitionReferenceId,
} from '@/utils/completed-competition-identity.util';

type TournamentMutationData = Record<string, unknown> & {
  format?: TournamentFormat;
  formatVersion?: 1 | 2 | 3;
  division?: CompetitionDivision;
};

const TOURNAMENT_STATUSES = new Set<string>(Object.values(TournamentStatus));
const TOURNAMENT_FORMATS = new Set<string>(Object.values(TournamentFormat));
export const PUBLIC_TOURNAMENT_FIELDS = [
  'name',
  'season',
  'startDate',
  'endDate',
  'status',
  'division',
  'currentStage',
  'fixturesGenerated',
  'formatVersion',
  'format',
  'workflowState',
  'championTeamId',
  'runnerUpTeamId',
  'thirdPlaceTeamId',
  'competitionCompletedAt',
  'createdAt',
  'updatedAt',
].join(' ');

export class TournamentMutationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'TournamentMutationError';
  }
}

export const createTournament = async (data: TournamentMutationData) => {
  const normalizedData = { ...data };
  if (typeof normalizedData.name === 'string') normalizedData.name = normalizedData.name.trim();
  if (typeof normalizedData.season === 'string') {
    normalizedData.season = normalizedData.season.trim();
  }
  const createsMensCompetition =
    normalizedData.formatVersion === 2 &&
    normalizedData.format === TournamentFormat.TWO_GROUP_KNOCKOUT &&
    resolveCompetitionDivision(normalizedData.division) === CompetitionDivision.MEN;
  const createsWomensCompetition =
    normalizedData.formatVersion === 3 &&
    normalizedData.format === TournamentFormat.SINGLE_TABLE_FINAL &&
    normalizedData.division === CompetitionDivision.WOMEN;
  if (!createsMensCompetition && !createsWomensCompetition) {
    throw new TournamentMutationError(
      'New tournaments must use a supported fixed competition format and division.',
      400,
      'FIXED_COMPETITION_FORMAT_REQUIRED'
    );
  }

  const rules = createsWomensCompetition
    ? FIXED_WOMENS_COMPETITION_RULES
    : FIXED_V2_COMPETITION_RULES;

  return await Tournament.create({
    ...normalizedData,
    formatVersion: createsWomensCompetition ? 3 : 2,
    format: createsWomensCompetition
      ? TournamentFormat.SINGLE_TABLE_FINAL
      : TournamentFormat.TWO_GROUP_KNOCKOUT,
    division: createsWomensCompetition
      ? CompetitionDivision.WOMEN
      : CompetitionDivision.MEN,
    workflowState: CompetitionWorkflowState.SETUP,
    workflowRevision: 0,
    currentStage: createsWomensCompetition ? MatchStage.LEAGUE : MatchStage.GROUP_STAGE,
    leagueRounds: createsWomensCompetition ? 3 : 0,
    fixturesGenerated: false,
    status: TournamentStatus.UPCOMING,
    competitionRules: {
      ...rules,
      tieBreakers: [
        CompetitionTieBreaker.POINTS,
        CompetitionTieBreaker.GOAL_DIFFERENCE,
        CompetitionTieBreaker.GOALS_FOR,
        CompetitionTieBreaker.HEAD_TO_HEAD,
        CompetitionTieBreaker.COMMITTEE_DECISION,
      ],
    },
    competitionTieResolutions: [],
  });
};

export const getTournaments = async (query: Record<string, unknown> = {}) => {
  const filter: Record<string, unknown> = { isDeleted: false };
  if (typeof query.status === 'string' && TOURNAMENT_STATUSES.has(query.status)) {
    filter.status = query.status;
  }
  if (typeof query.format === 'string' && TOURNAMENT_FORMATS.has(query.format)) {
    filter.format = query.format;
  }
  if (query.division === CompetitionDivision.MEN || query.division === CompetitionDivision.WOMEN) {
    Object.assign(filter, competitionDivisionFilter(query.division));
  }
  const tournaments = await Tournament.find(filter)
    .select(PUBLIC_TOURNAMENT_FIELDS)
    .populate('championTeamId runnerUpTeamId thirdPlaceTeamId', 'name logo city')
    .sort({ createdAt: -1 })
    .lean();
  const completedCompetitionIds = tournaments
    .filter(
      (tournament) =>
        ((tournament.formatVersion === 2 &&
          tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT) ||
          (tournament.formatVersion === 3 &&
            tournament.format === TournamentFormat.SINGLE_TABLE_FINAL)) &&
        tournament.workflowState === CompetitionWorkflowState.COMPLETED
    )
    .map((tournament) => tournament._id.toString());
  const normalizedTournaments = tournaments.map((tournament) => ({
    ...tournament,
    division: resolveCompetitionDivision(tournament.division),
  }));
  if (completedCompetitionIds.length === 0) return normalizedTournaments;

  const identitySnapshots = buildCompetitionIdentitySnapshotMap(
    await TournamentEntry.find({
      tournamentId: { $in: completedCompetitionIds },
      isDeleted: false,
    })
      .select('tournamentId teamId teamNameSnapshot teamLogoSnapshot')
      .lean()
  );
  return normalizedTournaments.map((tournament) => {
    const tournamentId = tournament._id.toString();
    if (!completedCompetitionIds.includes(tournamentId)) return tournament;
    const withSnapshot = (team: unknown) => {
      const teamId = competitionReferenceId(team);
      return teamId
        ? applyTeamIdentitySnapshot(
            team,
            identitySnapshots.get(competitionIdentityKey(tournamentId, teamId))
          )
        : team;
    };
    return {
      ...tournament,
      championTeamId: withSnapshot(tournament.championTeamId),
      runnerUpTeamId: withSnapshot(tournament.runnerUpTeamId),
      thirdPlaceTeamId: withSnapshot(tournament.thirdPlaceTeamId),
    };
  });
};

export const updateTournament = async (id: string, data: TournamentMutationData) => {
  const existing = await Tournament.findById(id).select(
    'formatVersion format fixturesGenerated workflowState startDate endDate'
  );
  if (!existing) return null;
  const changesDates =
    Object.prototype.hasOwnProperty.call(data, 'startDate') ||
    Object.prototype.hasOwnProperty.call(data, 'endDate');
  if (
    Object.prototype.hasOwnProperty.call(data, 'formatVersion') ||
    Object.prototype.hasOwnProperty.call(data, 'format') ||
    Object.prototype.hasOwnProperty.call(data, 'division')
  ) {
    throw new TournamentMutationError(
      'Tournament format and division are immutable after creation.',
      409,
      'TOURNAMENT_FORMAT_LOCKED'
    );
  }
  if (existing.formatVersion === 2 || existing.formatVersion === 3) {
    const workflowOwnedFields = [
      'workflowState',
      'workflowRevision',
      'entryIdentityRevision',
      'rosterIdentityRevision',
      'standingsRevision',
      'competitionRules',
      'competitionTieResolutions',
      'qualificationSnapshot',
      'qualificationFinalizedAt',
      'currentStage',
      'leagueRounds',
      'fixturesGenerated',
      'status',
      'championTeamId',
      'runnerUpTeamId',
      'thirdPlaceTeamId',
      'competitionCompletedAt',
    ];
    const attemptedWorkflowFields = workflowOwnedFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(data, field)
    );
    if (attemptedWorkflowFields.length > 0) {
      throw new TournamentMutationError(
        `Use the competition workflow to update: ${attemptedWorkflowFields.join(', ')}.`,
        409,
        'V2_WORKFLOW_FIELDS_LOCKED'
      );
    }
    if (changesDates && existing.fixturesGenerated) {
      throw new TournamentMutationError(
        'Tournament dates cannot be changed after fixtures are published. Use an explicit match reschedule workflow.',
        409,
        'TOURNAMENT_DATES_LOCKED'
      );
    }
  }
  if (
    changesDates &&
    !isTournamentDateRangeValid(
      existing.startDate,
      existing.endDate,
      data as TournamentDateChanges
    )
  ) {
    throw new TournamentMutationError(
      'End date cannot be before start date.',
      400,
      'INVALID_TOURNAMENT_DATE_RANGE'
    );
  }
  const set = { ...data };
  if (typeof set.name === 'string') set.name = set.name.trim();
  if (typeof set.season === 'string') set.season = set.season.trim();
  const clearsEndDate = set.endDate === null;
  if (clearsEndDate) delete set.endDate;
  return await Tournament.findByIdAndUpdate(
    id,
    clearsEndDate ? { $set: set, $unset: { endDate: 1 } } : { $set: set },
    { new: true, runValidators: true }
  );
};

export const getTournamentArchive = async () => {
  // Find all completed tournaments
  const completedTournaments = await Tournament.find({
    status: TournamentStatus.COMPLETED,
    isDeleted: false,
  })
    .populate('championTeamId', 'name city logo')
    .sort({ startDate: -1 })
    .lean();
  
  const archive = [];
  
  for (const tournament of completedTournaments) {
    if (
      (tournament.formatVersion === 2 &&
        tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT) ||
      (tournament.formatVersion === 3 &&
        tournament.format === TournamentFormat.SINGLE_TABLE_FINAL)
    ) {
      const championTeamId = competitionReferenceId(tournament.championTeamId);
      const championSnapshot = championTeamId
        ? await TournamentEntry.findOne({
            tournamentId: tournament._id,
            teamId: championTeamId,
            isDeleted: false,
          })
            .select('tournamentId teamId teamNameSnapshot teamLogoSnapshot')
            .lean()
        : null;
      archive.push({
        _id: tournament._id,
        name: tournament.name,
        season: tournament.season,
        formatVersion: tournament.formatVersion,
        format: tournament.format,
        division: resolveCompetitionDivision(tournament.division),
        champion: championSnapshot
          ? applyTeamIdentitySnapshot(tournament.championTeamId, championSnapshot)
          : tournament.championTeamId ?? null,
      });
      continue;
    }
    // Find the winner from standings for each tournament
    const topTeam = await Standings.findOne({ tournamentId: tournament._id })
      .sort({ points: -1, goalDifference: -1, goalsFor: -1 })
      .populate('teamId', 'name city')
      .lean();

    archive.push({
      _id: tournament._id,
      name: tournament.name,
      season: tournament.season,
      formatVersion: tournament.formatVersion,
      format: tournament.format,
      division: resolveCompetitionDivision(tournament.division),
      champion: topTeam ? topTeam.teamId : null,
    });
  }

  return archive;
};

import Player from '@/models/player.model';

export const checkTournamentReadiness = async (tournamentId: string) => {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new Error('Tournament not found');
  if (tournament.formatVersion === 2 || tournament.formatVersion === 3) {
    throw new Error(
      'Use the competition overview and entry readiness workflow for this tournament.'
    );
  }

  const teams = await Team.find({ isDeleted: false });
  const is28Teams = teams.length === 28;

  let allTeamsReady = true;
  const teamStatuses = [];

  for (const team of teams) {
    const playerCount = await Player.countDocuments({ teamId: team._id, isDeleted: false });
    const isReady = playerCount >= 5;
    if (!isReady) allTeamsReady = false;
    
    teamStatuses.push({
      teamId: team._id,
      name: team.name,
      playerCount,
      isReady
    });
  }

  return {
    isReady: is28Teams && allTeamsReady,
    totalTeams: teams.length,
    is28Teams,
    allTeamsReady,
    teamStatuses
  };
};

/**
 * Returns a structured bracket data object for the public-facing bracket UI.
 * Each stage contains the matches with populated team names and winner info.
 */
export const getBracketData = async (tournamentId: string) => {
  const tournament = await Tournament.findOne({ _id: tournamentId, isDeleted: false })
    .select('formatVersion format')
    .lean();
  if (
    tournament?.formatVersion === 2 &&
    tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT
  ) {
    return getCompetitionBracketState(tournamentId);
  }
  if (
    tournament?.formatVersion === 3 &&
    tournament.format === TournamentFormat.SINGLE_TABLE_FINAL
  ) {
    return getWomensBracketState(tournamentId);
  }

  const knockoutStages = [
    MatchStage.PLAYOFF,
    MatchStage.ROUND_OF_16,
    MatchStage.QUARTER_FINALS,
    MatchStage.SEMI_FINALS,
    MatchStage.FINAL,
  ];

  const bracket: Record<string, unknown[]> = {};

  for (const stage of knockoutStages) {
    const matches = await Match.find({ tournamentId, stage, isDeleted: false })
      .populate('homeTeam', 'name')
      .populate('awayTeam', 'name')
      .populate('winner', 'name')
      .sort({ scheduleStatus: 1, date: 1, officialFixtureNumber: 1, _id: 1 })
      .lean();

    bracket[stage] = matches.map(m => ({
      _id: m._id,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      status: m.status,
      date: m.date,
      venue: m.venue,
      winner: m.winner,
      isExtraTime: m.isExtraTime,
      shootoutScore: m.shootoutScore,
    }));
  }

  return bracket;
};
