import { ClientSession, Types } from 'mongoose';
import Player from '@/models/player.model';
import Team, { ITeam } from '@/models/team.model';
import TournamentEntry, { TournamentEntryStatus } from '@/models/tournament-entry.model';
import Tournament, {
  CompetitionWorkflowState,
  TournamentFormat,
} from '@/models/tournament.model';

export interface TeamLifecycleFenceOptions {
  registrationStatus?: ITeam['registrationStatus'];
}

export interface OpenTournamentEntryReference {
  tournamentId: string;
  tournamentName: string;
}

export class TeamLifecycleError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'TeamLifecycleError';
  }
}

/**
 * Every operation that creates a durable Team dependency must call this inside
 * the same transaction as that dependent write. Team withdrawal/deletion also
 * writes this document, so MongoDB write conflicts serialize the two paths.
 */
export const fenceTeamLifecycle = async (
  teamId: string | Types.ObjectId,
  session: ClientSession,
  options: TeamLifecycleFenceOptions = {}
): Promise<ITeam | null> =>
  Team.findOneAndUpdate(
    {
      _id: teamId,
      isDeleted: false,
      ...(options.registrationStatus
        ? { registrationStatus: options.registrationStatus }
        : {}),
    },
    { $inc: { lifecycleRevision: 1 } },
    { new: true, runValidators: true, session }
  ).select('+lifecycleRevision');

/**
 * Acquires multiple Team lifecycle fences in a stable order. Operations that
 * depend on several teams must use the same ordering so concurrent roster,
 * transfer, and competition-publication transactions cannot deadlock each
 * other while acquiring overlapping Team documents.
 */
export const fenceTeamLifecycles = async (
  teamIds: Array<string | Types.ObjectId>,
  session: ClientSession,
  options: TeamLifecycleFenceOptions = {}
): Promise<Map<string, ITeam | null>> => {
  const orderedTeamIds = [...new Set(teamIds.map((teamId) => teamId.toString()))].sort();
  const fencedTeams = new Map<string, ITeam | null>();

  for (const teamId of orderedTeamIds) {
    fencedTeams.set(teamId, await fenceTeamLifecycle(teamId, session, options));
  }

  return fencedTeams;
};

export const findOpenTournamentEntryForTeam = async (
  teamId: string | Types.ObjectId,
  session: ClientSession
): Promise<OpenTournamentEntryReference | null> => {
  const tournamentIds = await TournamentEntry.distinct('tournamentId', {
    teamId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  }).session(session);
  if (tournamentIds.length === 0) return null;

  const tournament = await Tournament.findOne({
    _id: { $in: tournamentIds },
    formatVersion: 2,
    format: TournamentFormat.TWO_GROUP_KNOCKOUT,
    workflowState: { $ne: CompetitionWorkflowState.COMPLETED },
    isDeleted: false,
  })
    .select('name')
    .session(session)
    .lean();
  if (!tournament) return null;

  return {
    tournamentId: tournament._id.toString(),
    tournamentName: tournament.name,
  };
};

export const countActivePlayersForTeam = (
  teamId: string | Types.ObjectId,
  session: ClientSession
): Promise<number> =>
  Player.countDocuments({ teamId, isDeleted: false }).session(session);
