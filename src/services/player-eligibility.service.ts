import { Types } from 'mongoose';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import TournamentEntry, {
  TournamentEntryStatus,
} from '@/models/tournament-entry.model';
import Tournament, {
  CompetitionWorkflowState,
  TournamentFormat,
} from '@/models/tournament.model';

export interface OpenCompetitionReference {
  tournamentId: string;
  name: string;
  season: string;
  workflowState: CompetitionWorkflowState;
}

const openTournamentFilter = {
  formatVersion: 2 as const,
  format: TournamentFormat.TWO_GROUP_KNOCKOUT,
  workflowState: { $ne: CompetitionWorkflowState.COMPLETED },
  isDeleted: false,
};

const listOpenTournaments = async (
  tournamentIds: Types.ObjectId[]
): Promise<OpenCompetitionReference[]> => {
  if (tournamentIds.length === 0) return [];
  const tournaments = await Tournament.find({
    _id: { $in: tournamentIds },
    ...openTournamentFilter,
  })
    .select('name season workflowState')
    .sort({ startDate: -1 })
    .lean();
  return tournaments.map((tournament) => ({
    tournamentId: tournament._id.toString(),
    name: tournament.name,
    season: tournament.season,
    workflowState: tournament.workflowState,
  }));
};

export const getOpenRosterLocksForPlayer = async (
  playerId: string
): Promise<OpenCompetitionReference[]> => {
  const tournamentIds = await TournamentRosterEntry.find({ playerId }).distinct('tournamentId');
  return listOpenTournaments(tournamentIds as Types.ObjectId[]);
};

export const getOpenPublishedCompetitionsForTeam = async (
  teamId: string
): Promise<OpenCompetitionReference[]> => {
  const tournamentIds = await TournamentEntry.find({
    teamId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  }).distinct('tournamentId');
  if (tournamentIds.length === 0) return [];
  const tournaments = await Tournament.find({
    _id: { $in: tournamentIds },
    ...openTournamentFilter,
    fixturesGenerated: true,
  })
    .select('name season workflowState')
    .sort({ startDate: -1 })
    .lean();
  return tournaments.map((tournament) => ({
    tournamentId: tournament._id.toString(),
    name: tournament.name,
    season: tournament.season,
    workflowState: tournament.workflowState,
  }));
};

/**
 * Returns only open published competitions whose immutable roster snapshot
 * does not contain this player for this team. This is intentionally evaluated
 * after player creation commits: if creation won the Team lifecycle fence,
 * publication includes the player; if publication won, the player is future-
 * only and the published competition is returned here.
 */
export const getOpenPublishedCompetitionsExcludingPlayer = async (
  teamId: string,
  playerId: string
): Promise<OpenCompetitionReference[]> => {
  const publishedCompetitions = await getOpenPublishedCompetitionsForTeam(teamId);
  if (publishedCompetitions.length === 0) return [];

  const publishedTournamentIds = publishedCompetitions.map(
    (competition) => competition.tournamentId
  );
  const capturedTournamentIds = await TournamentRosterEntry.find({
    tournamentId: { $in: publishedTournamentIds },
    teamId,
    playerId,
  }).distinct('tournamentId');
  const capturedTournamentIdSet = new Set(
    capturedTournamentIds.map((tournamentId) => tournamentId.toString())
  );

  return publishedCompetitions.filter(
    (competition) => !capturedTournamentIdSet.has(competition.tournamentId)
  );
};
