import { ClientSession, Types } from 'mongoose';
import Team from '@/models/team.model';
import Tournament, {
  CompetitionWorkflowState,
  TournamentFormat,
} from '@/models/tournament.model';
import TournamentEntry, {
  TournamentEntryStatus,
} from '@/models/tournament-entry.model';
import {
  buildCompetitionEntryIdentityUpdate,
  CompetitionEntryIdentity,
} from '@/utils/competition-entry-identity.util';
import { selectCompetitionTeamIdentity } from '@/utils/competition.util';

export interface CompetitionTeamIdentitySummary {
  _id: string;
  name?: string;
  logo?: string;
}

export const readCompetitionTeamIdentitySummaries = async (
  tournamentId: string | Types.ObjectId,
  teamIds: Array<string | Types.ObjectId>,
  competitionCompleted: boolean,
  session?: ClientSession
): Promise<Map<string, CompetitionTeamIdentitySummary>> => {
  const uniqueTeamIds = [...new Set(teamIds.map((teamId) => teamId.toString()))];
  if (uniqueTeamIds.length === 0) return new Map();

  const teamQuery = Team.find({ _id: { $in: uniqueTeamIds } })
    .select('name logo')
    .lean();
  const entryQuery = TournamentEntry.find({
    tournamentId,
    teamId: { $in: uniqueTeamIds },
    isDeleted: false,
  })
    .select('teamId teamNameSnapshot teamLogoSnapshot')
    .lean();
  if (session) {
    teamQuery.session(session);
    entryQuery.session(session);
  }

  // MongoDB does not support parallel operations on one transaction session.
  const [teams, entries] = session
    ? [await teamQuery, await entryQuery]
    : await Promise.all([teamQuery, entryQuery]);
  const currentById = new Map(teams.map((team) => [team._id.toString(), team]));
  const entryById = new Map(entries.map((entry) => [entry.teamId.toString(), entry]));
  const summaries = new Map<string, CompetitionTeamIdentitySummary>();

  for (const teamId of uniqueTeamIds) {
    const current = currentById.get(teamId);
    const entry = entryById.get(teamId);
    if (entry) {
      const identity = selectCompetitionTeamIdentity(
        { name: entry.teamNameSnapshot, logo: entry.teamLogoSnapshot },
        current,
        competitionCompleted
      );
      summaries.set(teamId, { _id: teamId, ...identity });
    } else if (current) {
      summaries.set(teamId, { _id: teamId, name: current.name, logo: current.logo });
    } else {
      summaries.set(teamId, { _id: teamId });
    }
  }

  return summaries;
};

/**
 * Call inside the same MongoDB transaction that persists a Team identity edit.
 * Open v2 snapshots follow the correction so the eventual season archive is
 * accurate; completed competition snapshots are deliberately excluded.
 */
export const refreshOpenCompetitionEntryIdentitySnapshots = async (
  teamId: string | Types.ObjectId,
  identity: CompetitionEntryIdentity,
  session: ClientSession
): Promise<number> => {
  const candidateTournamentIds = await TournamentEntry.distinct('tournamentId', {
    teamId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  }).session(session);
  if (candidateTournamentIds.length === 0) return 0;

  const fencedTournamentIds: Types.ObjectId[] = [];
  for (const tournamentId of candidateTournamentIds) {
    const fenced = await Tournament.findOneAndUpdate(
      {
        _id: tournamentId,
        $or: [
          { formatVersion: 2, format: TournamentFormat.TWO_GROUP_KNOCKOUT },
          { formatVersion: 3, format: TournamentFormat.SINGLE_TABLE_FINAL },
        ],
        workflowState: { $ne: CompetitionWorkflowState.COMPLETED },
        isDeleted: false,
      },
      { $inc: { entryIdentityRevision: 1 } },
      { new: true, session, projection: { _id: 1 } }
    );
    if (fenced) fencedTournamentIds.push(fenced._id);
  }
  if (fencedTournamentIds.length === 0) return 0;

  const result = await TournamentEntry.updateMany(
    {
      tournamentId: { $in: fencedTournamentIds },
      teamId,
      status: TournamentEntryStatus.ACTIVE,
      isDeleted: false,
    },
    buildCompetitionEntryIdentityUpdate(identity),
    { session }
  );
  return result.modifiedCount;
};

/**
 * Completed competition snapshots are immutable and may remain the only
 * reference to an older team logo. Call this before deleting a replaced
 * managed asset so archived seasons never acquire a broken image URL.
 */
export const completedCompetitionSnapshotReferencesLogo = async (
  teamId: string | Types.ObjectId,
  logoUrl: string
): Promise<boolean> => {
  const completedTournamentIds = await Tournament.find({
    $or: [
      { formatVersion: 2, format: TournamentFormat.TWO_GROUP_KNOCKOUT },
      { formatVersion: 3, format: TournamentFormat.SINGLE_TABLE_FINAL },
    ],
    workflowState: CompetitionWorkflowState.COMPLETED,
  }).distinct('_id');
  if (completedTournamentIds.length === 0) return false;

  return Boolean(
    await TournamentEntry.exists({
      tournamentId: { $in: completedTournamentIds },
      teamId,
      teamLogoSnapshot: logoUrl,
    })
  );
};
