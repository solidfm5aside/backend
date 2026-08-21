jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    __esModule: true,
    default: { ...actual.default, startSession: jest.fn() },
  };
});

jest.mock('@/models/player.model', () => ({
  __esModule: true,
  PlayerPosition: { GOALKEEPER: 'GK', DEFENDER: 'DF', MIDFIELDER: 'MF', FORWARD: 'FW' },
  default: { findOneAndUpdate: jest.fn() },
}));

jest.mock('@/models/tournament.model', () => ({
  __esModule: true,
  CompetitionWorkflowState: { COMPLETED: 'completed' },
  TournamentFormat: { TWO_GROUP_KNOCKOUT: 'two_group_knockout' },
  default: { find: jest.fn(), findOneAndUpdate: jest.fn() },
}));

jest.mock('@/models/tournament-roster-entry.model', () => ({
  __esModule: true,
  default: { distinct: jest.fn(), exists: jest.fn(), updateMany: jest.fn() },
}));

import mongoose, { Types } from 'mongoose';
import Player, { PlayerPosition } from '@/models/player.model';
import Tournament from '@/models/tournament.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import {
  completedCompetitionSnapshotReferencesPlayerPhoto,
  updatePlayerMetadataAndOpenRosterSnapshots,
} from '@/services/player-roster-identity.service';

const mockedPlayer = Player as unknown as { findOneAndUpdate: jest.Mock };
const mockedTournament = Tournament as unknown as {
  find: jest.Mock;
  findOneAndUpdate: jest.Mock;
};
const mockedRosterEntry = TournamentRosterEntry as unknown as {
  distinct: jest.Mock;
  exists: jest.Mock;
  updateMany: jest.Mock;
};
const mockedStartSession = mongoose.startSession as jest.MockedFunction<
  typeof mongoose.startSession
>;

const session = {
  endSession: jest.fn().mockResolvedValue(undefined),
  withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()),
};

describe('open tournament player roster identity refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStartSession.mockResolvedValue(session as never);
  });

  it('refreshes open v2 snapshots transactionally and leaves completed snapshots immutable', async () => {
    const playerId = new Types.ObjectId();
    const openTournamentId = new Types.ObjectId();
    const completedTournamentId = new Types.ObjectId();
    mockedPlayer.findOneAndUpdate.mockResolvedValue({
      _id: playerId,
      name: 'Updated Player',
      position: PlayerPosition.MIDFIELDER,
      jerseyNumber: 8,
      nationality: 'NG',
      passportPic: 'https://cdn.example.test/new-player.png',
    });
    mockedRosterEntry.distinct.mockReturnValue({
      session: jest.fn().mockResolvedValue([openTournamentId, completedTournamentId]),
    });
    mockedTournament.findOneAndUpdate
      .mockResolvedValueOnce({ _id: openTournamentId })
      .mockResolvedValueOnce(null);
    mockedRosterEntry.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await expect(
      updatePlayerMetadataAndOpenRosterSnapshots(
        { _id: playerId, isDeleted: false, __v: 3, competitionRosterRevision: 5 },
        { name: 'Updated Player', jerseyNumber: 8 }
      )
    ).resolves.toMatchObject({ name: 'Updated Player', jerseyNumber: 8 });

    expect(mockedPlayer.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: playerId, __v: 3, competitionRosterRevision: 5 }),
      {
        $set: { name: 'Updated Player', jerseyNumber: 8 },
        $inc: { competitionRosterRevision: 1, __v: 1 },
      },
      expect.objectContaining({ session, new: true, runValidators: true })
    );
    expect(mockedTournament.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(mockedTournament.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        _id: openTournamentId,
        workflowState: { $ne: 'completed' },
      }),
      { $inc: { rosterIdentityRevision: 1 } },
      expect.objectContaining({ session })
    );
    expect(mockedRosterEntry.updateMany).toHaveBeenCalledWith(
      {
        tournamentId: { $in: [openTournamentId] },
        playerId,
      },
      {
        $set: {
          playerNameSnapshot: 'Updated Player',
          positionSnapshot: PlayerPosition.MIDFIELDER,
          jerseyNumberSnapshot: 8,
          nationalitySnapshot: 'NG',
          photoSnapshot: 'https://cdn.example.test/new-player.png',
        },
      },
      { session }
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('detects a completed roster snapshot that references an old player photo', async () => {
    const tournamentId = new Types.ObjectId();
    const playerId = new Types.ObjectId();
    const photoUrl = 'https://cdn.example.test/old-player.png';
    mockedTournament.find.mockReturnValue({
      distinct: jest.fn().mockResolvedValue([tournamentId]),
    });
    mockedRosterEntry.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(
      completedCompetitionSnapshotReferencesPlayerPhoto(playerId, photoUrl)
    ).resolves.toBe(true);

    expect(mockedRosterEntry.exists).toHaveBeenCalledWith({
      tournamentId: { $in: [tournamentId] },
      playerId,
      photoSnapshot: photoUrl,
    });
  });

  it('removes the photo from open snapshots when the saved player photo is cleared', async () => {
    const playerId = new Types.ObjectId();
    const openTournamentId = new Types.ObjectId();
    mockedPlayer.findOneAndUpdate.mockResolvedValue({
      _id: playerId,
      name: 'Updated Player',
      position: PlayerPosition.DEFENDER,
      jerseyNumber: 4,
      nationality: 'NG',
      passportPic: '',
    });
    mockedRosterEntry.distinct.mockReturnValue({
      session: jest.fn().mockResolvedValue([openTournamentId]),
    });
    mockedTournament.findOneAndUpdate.mockResolvedValue({ _id: openTournamentId });
    mockedRosterEntry.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await updatePlayerMetadataAndOpenRosterSnapshots(
      { _id: playerId, __v: 2 },
      { passportPic: '' }
    );

    expect(mockedRosterEntry.updateMany).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: {
          playerNameSnapshot: 'Updated Player',
          positionSnapshot: PlayerPosition.DEFENDER,
          jerseyNumberSnapshot: 4,
          nationalitySnapshot: 'NG',
        },
        $unset: { photoSnapshot: 1 },
      },
      { session }
    );
  });
});
