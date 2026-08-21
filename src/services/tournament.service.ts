import Tournament, {
  CompetitionDrawMode,
  CompetitionTieBreaker,
  CompetitionWorkflowState,
  FIXED_V2_COMPETITION_RULES,
  TournamentFormat,
  TournamentStatus,
} from '@/models/tournament.model';
import Team from '@/models/team.model';
import Match, { MatchStage, MatchStatus } from '@/models/match.model';
import Standings from '@/models/standings.model';
import Venue from '@/models/venue.model';
import TournamentEntry from '@/models/tournament-entry.model';
import { generateLeagueFixtures } from '@/utils/scheduler.util';
import logger from '@/utils/logger';
import mongoose from 'mongoose';
import { getCompetitionBracketState } from './competition.service';
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
import {
  assertLegacySourceStageAvailable,
  assertLegacyStageGenerationAllowed,
  collectLegacyWinners,
  expectedLegacyStageMatchCount,
} from '@/utils/legacy-knockout.util';

type TournamentMutationData = Record<string, unknown> & {
  format?: TournamentFormat;
  formatVersion?: 1 | 2;
};

const TOURNAMENT_STATUSES = new Set<string>(Object.values(TournamentStatus));
const TOURNAMENT_FORMATS = new Set<string>(Object.values(TournamentFormat));
export const PUBLIC_TOURNAMENT_FIELDS = [
  'name',
  'season',
  'startDate',
  'endDate',
  'status',
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
  if (
    normalizedData.formatVersion !== 2 ||
    normalizedData.format !== TournamentFormat.TWO_GROUP_KNOCKOUT
  ) {
    throw new TournamentMutationError(
      'New tournaments must use the fixed two-group competition format.',
      400,
      'FIXED_COMPETITION_FORMAT_REQUIRED'
    );
  }

  return await Tournament.create({
    ...normalizedData,
    formatVersion: 2,
    format: TournamentFormat.TWO_GROUP_KNOCKOUT,
    workflowState: CompetitionWorkflowState.SETUP,
    workflowRevision: 0,
    currentStage: MatchStage.GROUP_STAGE,
    leagueRounds: 0,
    fixturesGenerated: false,
    status: TournamentStatus.UPCOMING,
    competitionRules: {
      ...FIXED_V2_COMPETITION_RULES,
      tieBreakers: [
        CompetitionTieBreaker.POINTS,
        CompetitionTieBreaker.GOAL_DIFFERENCE,
        CompetitionTieBreaker.GOALS_FOR,
        CompetitionTieBreaker.HEAD_TO_HEAD,
        CompetitionTieBreaker.COMMITTEE_DECISION,
      ],
      drawMode: CompetitionDrawMode.SEEDED_CROSS_GROUP,
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
  const tournaments = await Tournament.find(filter)
    .select(PUBLIC_TOURNAMENT_FIELDS)
    .populate('championTeamId runnerUpTeamId thirdPlaceTeamId', 'name logo city')
    .sort({ createdAt: -1 })
    .lean();
  const completedV2Ids = tournaments
    .filter(
      (tournament) =>
        tournament.formatVersion === 2 &&
        tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT &&
        tournament.workflowState === CompetitionWorkflowState.COMPLETED
    )
    .map((tournament) => tournament._id.toString());
  if (completedV2Ids.length === 0) return tournaments;

  const identitySnapshots = buildCompetitionIdentitySnapshotMap(
    await TournamentEntry.find({
      tournamentId: { $in: completedV2Ids },
      isDeleted: false,
    })
      .select('tournamentId teamId teamNameSnapshot teamLogoSnapshot')
      .lean()
  );
  return tournaments.map((tournament) => {
    const tournamentId = tournament._id.toString();
    if (!completedV2Ids.includes(tournamentId)) return tournament;
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
    Object.prototype.hasOwnProperty.call(data, 'format')
  ) {
    throw new TournamentMutationError(
      'Tournament format is immutable after creation.',
      409,
      'TOURNAMENT_FORMAT_LOCKED'
    );
  }
  if (existing.formatVersion === 2) {
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
        `Use the v2 competition workflow to update: ${attemptedWorkflowFields.join(', ')}.`,
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
      tournament.formatVersion === 2 &&
      tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT
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
      champion: topTeam ? topTeam.teamId : null,
    });
  }

  return archive;
};

import Player from '@/models/player.model';

export const checkTournamentReadiness = async (tournamentId: string) => {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new Error('Tournament not found');
  if (tournament.formatVersion === 2) {
    throw new Error('Use the v2 competition overview and entry readiness workflow for this tournament.');
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

export const generateTournamentFixtures = async (tournamentId: string, numRounds: number = 6, matchesPerDay: number = 7) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tournament = await Tournament.findById(tournamentId).session(session);
    if (!tournament) throw new Error('Tournament not found');
    if (tournament.formatVersion === 2) {
      throw new Error('Use /competition/group-fixtures/preview and /publish for v2 tournaments.');
    }

    // ONE-TIME LOCK
    if (tournament.fixturesGenerated) {
      throw new Error('Fixtures have already been generated for this tournament.');
    }

    const existingLeagueMatches = await Match.countDocuments({
      tournamentId,
      stage: MatchStage.LEAGUE,
      isDeleted: false,
    }).session(session);
    if (existingLeagueMatches > 0) {
      throw new Error('League fixtures have already been generated for this tournament.');
    }

    const teams = await Team.find({ isDeleted: false }).session(session);
    if (teams.length < 2) throw new Error('Need at least 2 teams to generate fixtures.');

    const teamIds = teams.map(t => t._id.toString());
    const roundPairs = generateLeagueFixtures(teamIds, numRounds);
    
    // Flatten all matches into a single queue
    const allMatches = roundPairs.flat();
    
    const venues = await Venue.find({ isDeleted: false })
      .sort({ importance: 1 })
      .session(session);
    if (venues.length === 0) {
      throw new Error('No venues configured. Please add a venue first.');
    }

    const getNextSaturday = (date: Date): Date => {
      const d = new Date(date);
      const day = d.getUTCDay();
      const diff = (6 - day + 7) % 7; 
      d.setUTCDate(d.getUTCDate() + diff);
      d.setUTCHours(10, 0, 0, 0); 
      return d;
    };

    const matchDocs = [];
    let currentMatchDate = getNextSaturday(new Date(tournament.startDate));
    let matchesScheduledOnCurrentDay = 0;
    let currentDayIsSaturday = true;

    for (let i = 0; i < allMatches.length; i++) {
      if (matchesScheduledOnCurrentDay >= matchesPerDay) {
        matchesScheduledOnCurrentDay = 0;
        if (currentDayIsSaturday) {
          currentMatchDate.setUTCDate(currentMatchDate.getUTCDate() + 1);
          currentDayIsSaturday = false;
        } else {
          currentMatchDate.setUTCDate(currentMatchDate.getUTCDate() + 6);
          currentDayIsSaturday = true;
        }
      }

      const slotIndex = Math.floor(matchesScheduledOnCurrentDay / venues.length);
      const venueIndex = matchesScheduledOnCurrentDay % venues.length;
      
      const matchTime = new Date(currentMatchDate);
      matchTime.setUTCHours(10 + (slotIndex * 2), 0, 0, 0); 

      // Calculate which round this match belongs to (approximate based on order)
      const roundNumber = Math.floor(i / 14) + 1;

      matchDocs.push({
        tournamentId,
        homeTeam: allMatches[i].team1,
        awayTeam: allMatches[i].team2,
        date: matchTime,
        venue: venues[venueIndex].name,
        stage: MatchStage.LEAGUE,
        round: roundNumber,
        status: 'scheduled',
        events: []
      });

      matchesScheduledOnCurrentDay++;
    }



    const reserved = await Tournament.updateOne(
      {
        _id: tournamentId,
        __v: tournament.__v ?? 0,
        fixturesGenerated: false,
      },
      {
        $set: {
          leagueRounds: numRounds,
          currentStage: MatchStage.LEAGUE,
          fixturesGenerated: true,
          status: TournamentStatus.ONGOING,
        },
        $inc: { __v: 1 },
      },
      { session }
    );
    if (reserved.modifiedCount !== 1) {
      throw new Error('Tournament fixture generation changed concurrently. Refresh and retry.');
    }

    await Match.insertMany(matchDocs, { session });

    // Initialize Standings for all teams
    const standingsDocs = teams.map(team => ({
      tournamentId,
      teamId: team._id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0
    }));

    await Standings.insertMany(standingsDocs, { session });

    await session.commitTransaction();
    logger.info(`Generated ${matchDocs.length} fixtures for tournament ${tournamentId}`);
    return matchDocs;
  } catch (error) {
    await session.abortTransaction();
    logger.error('Fixture Generation Error:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

export const generateKnockoutFixtures = async (tournamentId: string, stage: MatchStage = MatchStage.ROUND_OF_16) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tournament = await Tournament.findById(tournamentId).session(session);
    if (!tournament) throw new Error('Tournament not found');
    if (tournament.formatVersion === 2) {
      throw new Error('Use the persisted v2 competition draw workflow for v2 tournaments.');
    }

    const existingRequestedStageMatches = await Match.countDocuments({
      tournamentId,
      stage,
      isDeleted: false,
    }).session(session);
    assertLegacyStageGenerationAllowed(
      tournament.currentStage,
      stage,
      existingRequestedStageMatches
    );

    const currentStageMatchCount = await Match.countDocuments({
      tournamentId,
      stage: tournament.currentStage,
      isDeleted: false,
    }).session(session);
    assertLegacySourceStageAvailable(
      tournament.fixturesGenerated,
      tournament.currentStage,
      currentStageMatchCount
    );

    // Verify all current stage matches are completed
    const pendingMatches = await Match.countDocuments({ 
      tournamentId, 
      stage: tournament.currentStage,
      status: { $ne: MatchStatus.COMPLETED },
      isDeleted: false
    }).session(session);

    if (pendingMatches > 0) {
      throw new Error(`Cannot proceed to ${stage}. There are ${pendingMatches} matches pending in the ${tournament.currentStage} stage.`);
    }

    let pairs: { team1: string, team2: string }[] = [];

    if (stage === MatchStage.PLAYOFF) {
      // Get Teams 9-24 from Standings (16 teams)
      const standings = await Standings.find({ tournamentId })
        .sort({ points: -1, goalDifference: -1, goalsFor: -1 })
        .skip(8)
        .limit(16)
        .session(session);

      if (standings.length < 16) throw new Error('Insufficient teams in standings for Playoff round');
      
      const playoffTeams = standings.map(s => s.teamId.toString());
      // Pair 9-16 (High Seeds) vs 17-24 (Unseeded)
      // 9th vs 24th, 10th vs 23rd, etc.
      for (let i = 0; i < 8; i++) {
        pairs.push({
          team1: playoffTeams[i],
          team2: playoffTeams[playoffTeams.length - 1 - i]
        });
      }
    } else if (stage === MatchStage.ROUND_OF_16) {
      // NEW UCL FORMAT: Seeds (1-8) vs Playoff Winners
      const seedsRecord = await Standings.find({ tournamentId })
        .sort({ points: -1, goalDifference: -1, goalsFor: -1 })
        .limit(8)
        .session(session);
      
      if (seedsRecord.length < 8) throw new Error('Insufficient teams in standings for Round of 16 Seeds');
      const seeds = seedsRecord.map(s => s.teamId.toString());

      const playoffMatches = await Match.find({
        tournamentId,
        stage: MatchStage.PLAYOFF,
        isDeleted: false,
      }).session(session);
      const playoffWinners = collectLegacyWinners(playoffMatches, MatchStage.PLAYOFF);

      // Pair Seeds vs Playoff Winners. The explicit winner is authoritative,
      // including when a tied match was decided by penalties.
      for (let i = 0; i < 8; i++) {
        pairs.push({
          team1: seeds[i],
          team2: playoffWinners[playoffWinners.length - 1 - i]
        });
      }
    } else {
      // For later stages (QF, SF, Final), use the explicit `winner` field.
      // This is set by the Match Console via PATCH /matches/:id/winner after ET or penalties.
      const prevStage = getPreviousStage(stage);
      const prevMatches = await Match.find({
        tournamentId,
        stage: prevStage,
        isDeleted: false,
      }).session(session);
      const winners = collectLegacyWinners(prevMatches, prevStage);
      const expectedPairCount = expectedLegacyStageMatchCount(stage);
      if (!expectedPairCount || winners.length !== expectedPairCount * 2) {
        throw new Error(`Insufficient winners for ${stage}`);
      }

      for (let i = 0; i < winners.length / 2; i++) {
        pairs.push({
          team1: winners[i],
          team2: winners[winners.length - 1 - i]
        });
      }
    }

    if (pairs.length === 0) throw new Error(`Could not determine matches for ${stage}`);

    const venues = await Venue.find({ isDeleted: false })
      .sort({ importance: 1 })
      .session(session);
    const lastMatch = await Match.findOne({ tournamentId, isDeleted: false })
      .sort({ date: -1 })
      .session(session);
    const nextDate = new Date(lastMatch ? lastMatch.date : tournament.startDate);
    
    // Find next Saturday
    const day = nextDate.getUTCDay();
    const diff = (6 - day + 7) % 7 || 7; 
    nextDate.setUTCDate(nextDate.getUTCDate() + diff);
    nextDate.setUTCHours(10, 0, 0, 0);

    const matchDocs = pairs.map((pair, idx) => {
      const isSaturday = idx < pairs.length / 2;
      const mDate = new Date(nextDate);
      if (!isSaturday) mDate.setUTCDate(mDate.getUTCDate() + 1); 

      const slotIdx = isSaturday ? idx : (idx - Math.floor(pairs.length / 2));
      mDate.setUTCHours(10 + (slotIdx * 2), 0, 0, 0);

      return {
        tournamentId,
        homeTeam: pair.team1,
        awayTeam: pair.team2,
        date: mDate,
        venue: venues[slotIdx % venues.length]?.name || 'Main Court',
        stage: stage,
        status: 'scheduled',
        events: []
      };
    });

    const reserved = await Tournament.updateOne(
      {
        _id: tournamentId,
        __v: tournament.__v ?? 0,
        currentStage: tournament.currentStage,
        formatVersion: { $ne: 2 },
      },
      { $set: { currentStage: stage }, $inc: { __v: 1 } },
      { session }
    );
    if (reserved.modifiedCount !== 1) {
      throw new Error('Tournament stage changed concurrently. Refresh and retry.');
    }

    await Match.updateMany(
      {
        tournamentId,
        stage: tournament.currentStage,
        status: MatchStatus.COMPLETED,
        isDeleted: false,
      },
      {
        $set: {
          resultLockedAt: new Date(),
          resultLockReason: `Advanced to ${stage}`,
        },
      },
      { session }
    );
    await Match.insertMany(matchDocs, { session });

    await session.commitTransaction();
    return matchDocs;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getPreviousStage = (stage: MatchStage): MatchStage => {
  switch (stage) {
    case MatchStage.PLAYOFF: return MatchStage.LEAGUE;
    case MatchStage.ROUND_OF_16: return MatchStage.PLAYOFF;
    case MatchStage.QUARTER_FINALS: return MatchStage.ROUND_OF_16;
    case MatchStage.SEMI_FINALS: return MatchStage.QUARTER_FINALS;
    case MatchStage.FINAL: return MatchStage.SEMI_FINALS;
    default: return MatchStage.LEAGUE;
  }
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
      .sort({ date: 1 })
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
