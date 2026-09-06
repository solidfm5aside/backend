import { ClientSession, Types } from 'mongoose';
import Player, { IPlayer } from '@/models/player.model';
import Tournament, {
  CompetitionWorkflowState,
  TournamentFormat,
} from '@/models/tournament.model';
import TournamentEntry, {
  TournamentEntryStatus,
} from '@/models/tournament-entry.model';
import TournamentRosterEntry, {
  ITournamentRosterEntry,
} from '@/models/tournament-roster-entry.model';
import { CompetitionDivision } from '@/models/competition-division';

export class OpenPublishedLateRosterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'OpenPublishedLateRosterError';
  }
}

export interface OpenPublishedLateRosterEnrollmentResult {
  enrolledTournamentIds: string[];
  alreadyEnrolledTournamentIds: string[];
  excludedTournamentIds: string[];
}

const playerRevisionFilter = (revision: number) =>
  revision === 0
    ? {
        $or: [
          { competitionRosterRevision: 0 },
          { competitionRosterRevision: { $exists: false } },
        ],
      }
    : { competitionRosterRevision: revision };

const sameOptionalString = (left?: string, right?: string): boolean =>
  (left?.trim() ?? '') === (right?.trim() ?? '');

const snapshotMatchesPlayer = (
  snapshot: ITournamentRosterEntry,
  player: IPlayer,
  tournamentEntryId: string,
  teamId: string
): boolean =>
  snapshot.tournamentEntryId.toString() === tournamentEntryId &&
  snapshot.teamId.toString() === teamId &&
  snapshot.playerId.toString() === player._id.toString() &&
  snapshot.playerNameSnapshot === player.name &&
  snapshot.positionSnapshot === player.position &&
  snapshot.jerseyNumberSnapshot === player.jerseyNumber &&
  snapshot.nationalitySnapshot === player.nationality &&
  sameOptionalString(snapshot.photoSnapshot, player.passportPic);

const isOpenPublishedCompetition = (tournament: {
  formatVersion?: number;
  format?: TournamentFormat;
  division?: CompetitionDivision | null;
  fixturesGenerated?: boolean;
  workflowState?: CompetitionWorkflowState;
}): boolean => {
  if (!tournament.fixturesGenerated) return false;
  if (tournament.workflowState === CompetitionWorkflowState.COMPLETED) return false;
  if (
    tournament.formatVersion === 2 &&
    tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT
  ) {
    return tournament.division !== CompetitionDivision.WOMEN;
  }
  return (
    tournament.formatVersion === 3 &&
    tournament.format === TournamentFormat.SINGLE_TABLE_FINAL &&
    tournament.division === CompetitionDivision.WOMEN
  );
};

/**
 * Adds a newly-created or just-transferred player to an already-published
 * open tournament roster. Play may already have started; the snapshot is
 * additive only and never rewrites an existing player row.
 *
 * The caller must already hold the destination Team lifecycle fence.
 */
export const enrollPlayerInOpenPublishedCompetitions = async (
  playerId: string | Types.ObjectId,
  teamId: string | Types.ObjectId,
  expectedPlayerVersion: number,
  session: ClientSession
): Promise<OpenPublishedLateRosterEnrollmentResult> => {
  const normalizedTeamId = teamId.toString();
  const player = await Player.findOne({
    _id: playerId,
    teamId,
    isDeleted: false,
    __v: expectedPlayerVersion,
  })
    .select(
      '+competitionRosterRevision name position jerseyNumber nationality passportPic teamId __v'
    )
    .session(session);
  if (!player) {
    throw new OpenPublishedLateRosterError(
      'The player changed before tournament eligibility could be captured. Refresh and retry.',
      409,
      'PLAYER_ROSTER_STATE_CHANGED'
    );
  }

  const candidateEntries = await TournamentEntry.find({
    teamId,
    status: TournamentEntryStatus.ACTIVE,
    isDeleted: false,
  })
    .select('tournamentId teamId')
    .sort({ tournamentId: 1, _id: 1 })
    .session(session)
    .lean();
  if (candidateEntries.length === 0) {
    return {
      enrolledTournamentIds: [],
      alreadyEnrolledTournamentIds: [],
      excludedTournamentIds: [],
    };
  }

  const enrolledTournamentIds: string[] = [];
  const alreadyEnrolledTournamentIds: string[] = [];
  const excludedTournamentIds: string[] = [];

  for (const entry of candidateEntries) {
    const tournamentId = entry.tournamentId.toString();
    const tournament = await Tournament.findOne({
      _id: entry.tournamentId,
      fixturesGenerated: true,
      workflowState: { $ne: CompetitionWorkflowState.COMPLETED },
      isDeleted: false,
      $or: [
        {
          formatVersion: 2,
          format: TournamentFormat.TWO_GROUP_KNOCKOUT,
        },
        {
          formatVersion: 3,
          format: TournamentFormat.SINGLE_TABLE_FINAL,
          division: CompetitionDivision.WOMEN,
        },
      ],
    })
      .select(
        '+rosterIdentityRevision workflowRevision competitionRules formatVersion format division fixturesGenerated workflowState __v'
      )
      .session(session);
    if (!tournament || !isOpenPublishedCompetition(tournament)) continue;

    const maxRosterPlayers = tournament.competitionRules?.maxRosterPlayers;
    if (maxRosterPlayers === undefined || !Number.isInteger(maxRosterPlayers) || maxRosterPlayers < 1) {
      excludedTournamentIds.push(tournamentId);
      continue;
    }

    const existingSnapshot = await TournamentRosterEntry.findOne({
      tournamentId: entry.tournamentId,
      playerId,
    }).session(session);
    if (existingSnapshot) {
      if (
        !snapshotMatchesPlayer(
          existingSnapshot,
          player,
          entry._id.toString(),
          normalizedTeamId
        )
      ) {
        throw new OpenPublishedLateRosterError(
          'An incompatible tournament roster snapshot already exists for this player.',
          409,
          'OPEN_ROSTER_SNAPSHOT_CONFLICT'
        );
      }
      alreadyEnrolledTournamentIds.push(tournamentId);
      continue;
    }

    const rosterCount = await TournamentRosterEntry.countDocuments({
      tournamentId: entry.tournamentId,
      teamId,
    }).session(session);
    if (rosterCount >= maxRosterPlayers) {
      excludedTournamentIds.push(tournamentId);
      continue;
    }

    const currentRosterIdentityRevision = tournament.rosterIdentityRevision ?? 0;
    const fencedTournament = await Tournament.findOneAndUpdate(
      {
        _id: tournament._id,
        formatVersion: tournament.formatVersion,
        format: tournament.format,
        fixturesGenerated: true,
        workflowState: { $ne: CompetitionWorkflowState.COMPLETED },
        workflowRevision: tournament.workflowRevision,
        rosterIdentityRevision: currentRosterIdentityRevision,
        __v: tournament.__v ?? 0,
        isDeleted: false,
      },
      { $inc: { rosterIdentityRevision: 1, __v: 1 } },
      { new: true, session, projection: { _id: 1 } }
    );
    if (!fencedTournament) {
      throw new OpenPublishedLateRosterError(
        'The tournament changed while player eligibility was being captured.',
        409,
        'OPEN_ROSTER_STATE_CHANGED'
      );
    }

    await TournamentRosterEntry.create(
      [
        {
          tournamentId: entry.tournamentId,
          tournamentEntryId: entry._id,
          teamId,
          playerId,
          playerNameSnapshot: player.name,
          positionSnapshot: player.position,
          jerseyNumberSnapshot: player.jerseyNumber,
          nationalitySnapshot: player.nationality,
          ...(player.passportPic ? { photoSnapshot: player.passportPic } : {}),
          publicationRevision: tournament.workflowRevision,
          capturedAt: new Date(),
        },
      ],
      { session }
    );
    enrolledTournamentIds.push(tournamentId);
  }

  if (enrolledTournamentIds.length > 0) {
    const revision = player.competitionRosterRevision ?? 0;
    const playerFence = await Player.updateOne(
      {
        _id: playerId,
        teamId,
        isDeleted: false,
        __v: expectedPlayerVersion,
        ...playerRevisionFilter(revision),
      },
      { $inc: { competitionRosterRevision: 1 } },
      { session }
    );
    if (playerFence.modifiedCount !== 1) {
      throw new OpenPublishedLateRosterError(
        'The player changed while tournament eligibility was being captured. Refresh and retry.',
        409,
        'PLAYER_ROSTER_STATE_CHANGED'
      );
    }
  }

  return {
    enrolledTournamentIds,
    alreadyEnrolledTournamentIds,
    excludedTournamentIds,
  };
};
