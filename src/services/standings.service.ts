import Standings from '@/models/standings.model';
import PlayerStats from '@/models/player-stats.model';
import Match from '@/models/match.model';
import Tournament, {
  CompetitionWorkflowState,
  TournamentFormat,
} from '@/models/tournament.model';
import TournamentEntry from '@/models/tournament-entry.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import logger from '@/utils/logger';
import mongoose, { ClientSession, Types } from 'mongoose';
import { buildLegacyTournamentStatsSnapshot } from '@/utils/legacy-stats.util';
import {
  applyCompletedCompetitionScorerIdentitySnapshots,
  buildCompetitionIdentitySnapshotMap,
  buildCompetitionPlayerIdentitySnapshotMap,
  competitionReferenceId,
} from '@/utils/completed-competition-identity.util';
import {
  calculateGroupedStandings,
  recalculateCompetitionStandingsInSession,
} from './competition.service';
import {
  calculateWomensStandings,
  recalculateWomensStandingsInSession,
} from './womens-competition.service';

const tournamentStatusPriority = (status: string): number => {
  if (status === 'ongoing') return 0;
  if (status === 'completed') return 1;
  return 2;
};

const compareActiveTournaments = (
  left: { status: string; startDate: Date },
  right: { status: string; startDate: Date }
): number =>
  tournamentStatusPriority(left.status) - tournamentStatusPriority(right.status) ||
  right.startDate.getTime() - left.startDate.getTime();

/**
 * Completely recalculates all stats for a tournament based on match data and events.
 * This effectively makes standings and player stats "Live" if live matches are included.
 */
const recalculateTournamentStatsInSession = async (
  tournamentId: string,
  session: ClientSession
): Promise<void> => {
  const tournament = await Tournament.findById(tournamentId)
    .select('formatVersion format')
    .session(session)
    .lean();
  if (
    tournament?.formatVersion === 2 &&
    tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT
  ) {
    await recalculateCompetitionStandingsInSession(tournamentId, session);
    return;
  }
  if (
    tournament?.formatVersion === 3 &&
    tournament.format === TournamentFormat.SINGLE_TABLE_FINAL
  ) {
    await recalculateWomensStandingsInSession(tournamentId, session);
    return;
  }

  const matches = await Match.find({
    tournamentId,
    isDeleted: false,
  })
    .session(session)
    .lean();
  const snapshot = buildLegacyTournamentStatsSnapshot(matches);
  const tournamentObjectId = new Types.ObjectId(tournamentId);

  // Replace both derived collections inside the caller's transaction. Match
  // mutations and their derived rows therefore commit or roll back together.
  await Standings.deleteMany({ tournamentId: tournamentObjectId }).session(session);
  await PlayerStats.deleteMany({ tournamentId: tournamentObjectId }).session(session);
  if (snapshot.standings.length > 0) {
    await Standings.insertMany(
      snapshot.standings.map((row) => ({
        ...row,
        tournamentId: tournamentObjectId,
        teamId: new Types.ObjectId(row.teamId),
      })),
      { session, ordered: true }
    );
  }
  if (snapshot.playerStats.length > 0) {
    await PlayerStats.insertMany(
      snapshot.playerStats.map((row) => ({
        ...row,
        tournamentId: tournamentObjectId,
        playerId: new Types.ObjectId(row.playerId),
        teamId: new Types.ObjectId(row.teamId),
      })),
      { session, ordered: true }
    );
  }
};

export const recalculateTournamentStats = async (
  tournamentId: string,
  existingSession?: ClientSession
): Promise<void> => {
  try {
    if (existingSession) {
      await recalculateTournamentStatsInSession(tournamentId, existingSession);
    } else {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await recalculateTournamentStatsInSession(tournamentId, session);
        });
      } finally {
        await session.endSession();
      }
    }
    logger.info(`Recalculated stats for tournament ${tournamentId}`);
  } catch (error) {
    logger.error(`Error recalculating stats for tournament ${tournamentId}:`, error);
    throw error;
  }
};

export const getTournamentStandings = async (tournamentId: string) => {
  const tournament = await Tournament.findById(tournamentId).select('formatVersion format').lean();
  if (
    tournament?.formatVersion === 2 &&
    tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT
  ) {
    const groups = await calculateGroupedStandings(tournamentId);
    return [...groups.A, ...groups.B];
  }
  if (
    tournament?.formatVersion === 3 &&
    tournament.format === TournamentFormat.SINGLE_TABLE_FINAL
  ) {
    return calculateWomensStandings(tournamentId);
  }
  return await Standings.find({ tournamentId })
    .populate('teamId', 'name logo')
    .sort({ points: -1, goalDifference: -1, goalsFor: -1 });
};

export const getTopScorers = async (tournamentId: string) => {
  const tournament = await Tournament.findById(tournamentId)
    .select('formatVersion format workflowState')
    .lean();
  const completedCompetition = Boolean(
    tournament?.workflowState === CompetitionWorkflowState.COMPLETED &&
      ((tournament.formatVersion === 2 &&
        tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT) ||
        (tournament.formatVersion === 3 &&
          tournament.format === TournamentFormat.SINGLE_TABLE_FINAL))
  );
  const statsQuery = PlayerStats.find({ tournamentId })
    .sort({ goals: -1, assists: -1 })
    .limit(10);
  if (!completedCompetition) {
    return await statsQuery
      .populate('playerId', 'name')
      .populate('teamId', 'name logo');
  }

  const scorers = await statsQuery.lean();
  const playerIds = scorers
    .map((scorer) => competitionReferenceId(scorer.playerId))
    .filter((id): id is string => Boolean(id));
  const teamIds = scorers
    .map((scorer) => competitionReferenceId(scorer.teamId))
    .filter((id): id is string => Boolean(id));
  const [playerSnapshots, teamSnapshots] = await Promise.all([
    TournamentRosterEntry.find({
      tournamentId,
      playerId: { $in: playerIds },
    })
      .select('tournamentId playerId playerNameSnapshot')
      .lean(),
    TournamentEntry.find({
      tournamentId,
      teamId: { $in: teamIds },
      isDeleted: false,
    })
      .select('tournamentId teamId teamNameSnapshot teamLogoSnapshot')
      .lean(),
  ]);
  return applyCompletedCompetitionScorerIdentitySnapshots(
    scorers,
    new Set([tournamentId]),
    buildCompetitionIdentitySnapshotMap(teamSnapshots),
    buildCompetitionPlayerIdentitySnapshotMap(playerSnapshots)
  );
};

export const getGlobalTournamentStandings = async () => {
  const tournaments = await Tournament.find({ isDeleted: false });
  tournaments.sort(compareActiveTournaments);

  const result = [];
  for (const t of tournaments) {
    const stats = await getTournamentStandings(t._id.toString());
    result.push({
      tournamentId: t,
      stats: stats
    });
  }
  return result;
};

export const getGlobalTopScorers = async () => {
  const tournaments = await Tournament.find({ isDeleted: false });
  tournaments.sort(compareActiveTournaments);
  const tournament = tournaments[0];

  if (!tournament) return [];
  return await getTopScorers(tournament._id.toString());
};


