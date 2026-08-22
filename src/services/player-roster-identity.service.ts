import mongoose, { ClientSession, QueryFilter, Types } from 'mongoose';
import Player, { IPlayer, PlayerPosition } from '@/models/player.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import Tournament, {
  CompetitionWorkflowState,
  TournamentFormat,
} from '@/models/tournament.model';

export interface PlayerRosterIdentitySnapshot {
  name: string;
  position: PlayerPosition;
  jerseyNumber: number;
  nationality: string;
  photo?: string;
}

/**
 * Call inside the same transaction that persists the Player metadata edit.
 * Writing the Tournament document fences this operation against competition
 * completion. A completion that wins first is excluded; an edit that wins
 * first is captured before completion can commit.
 */
export const refreshOpenTournamentRosterPlayerSnapshots = async (
  playerId: string | Types.ObjectId,
  snapshot: PlayerRosterIdentitySnapshot,
  session: ClientSession
): Promise<number> => {
  const candidateTournamentIds = await TournamentRosterEntry.distinct('tournamentId', {
    playerId,
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
      { $inc: { rosterIdentityRevision: 1 } },
      { new: true, session, projection: { _id: 1 } }
    );
    if (fenced) fencedTournamentIds.push(fenced._id);
  }
  if (fencedTournamentIds.length === 0) return 0;

  const result = await TournamentRosterEntry.updateMany(
    {
      tournamentId: { $in: fencedTournamentIds },
      playerId,
    },
    snapshot.photo
      ? {
          $set: {
            playerNameSnapshot: snapshot.name,
            positionSnapshot: snapshot.position,
            jerseyNumberSnapshot: snapshot.jerseyNumber,
            nationalitySnapshot: snapshot.nationality,
            photoSnapshot: snapshot.photo,
          },
        }
      : {
          $set: {
            playerNameSnapshot: snapshot.name,
            positionSnapshot: snapshot.position,
            jerseyNumberSnapshot: snapshot.jerseyNumber,
            nationalitySnapshot: snapshot.nationality,
          },
          $unset: { photoSnapshot: 1 },
        },
    { session }
  );
  return result.modifiedCount;
};

export const updatePlayerMetadataAndOpenRosterSnapshots = async (
  filter: QueryFilter<IPlayer>,
  updates: Record<string, unknown>
): Promise<IPlayer | null> => {
  const session = await mongoose.startSession();
  let player: IPlayer | null = null;

  try {
    await session.withTransaction(async () => {
      player = null;
      const updatedPlayer = await Player.findOneAndUpdate(
        filter,
        {
          $set: updates,
          $inc: { competitionRosterRevision: 1, __v: 1 },
        },
        { new: true, runValidators: true, session }
      );
      player = updatedPlayer;
      if (!updatedPlayer) return;

      await refreshOpenTournamentRosterPlayerSnapshots(
        updatedPlayer._id,
        {
          name: updatedPlayer.name,
          position: updatedPlayer.position,
          jerseyNumber: updatedPlayer.jerseyNumber,
          nationality: updatedPlayer.nationality,
          photo: updatedPlayer.passportPic || undefined,
        },
        session
      );
    });
    return player;
  } finally {
    await session.endSession();
  }
};

export const completedCompetitionSnapshotReferencesPlayerPhoto = async (
  playerId: string | Types.ObjectId,
  photoUrl: string
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
    await TournamentRosterEntry.exists({
      tournamentId: { $in: completedTournamentIds },
      playerId,
      photoSnapshot: photoUrl,
    })
  );
};
