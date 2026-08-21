jest.mock('@/models/team.model', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));

jest.mock('@/models/tournament-entry.model', () => {
  const actual = jest.requireActual('@/models/tournament-entry.model');
  return {
    __esModule: true,
    ...actual,
    default: {
      distinct: jest.fn(),
      exists: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn(),
    },
  };
});

jest.mock('@/models/tournament.model', () => {
  const actual = jest.requireActual('@/models/tournament.model');
  return {
    __esModule: true,
    ...actual,
    default: { find: jest.fn(), findOneAndUpdate: jest.fn() },
  };
});

import { Types } from 'mongoose';
import Tournament from '@/models/tournament.model';
import TournamentEntry from '@/models/tournament-entry.model';
import {
  completedCompetitionSnapshotReferencesLogo,
  refreshOpenCompetitionEntryIdentitySnapshots,
} from '@/services/competition-entry-identity.service';

const mockedTournament = Tournament as unknown as {
  find: jest.Mock;
  findOneAndUpdate: jest.Mock;
};
const mockedEntry = TournamentEntry as unknown as {
  distinct: jest.Mock;
  exists: jest.Mock;
  updateMany: jest.Mock;
};

describe('competition entry identity transaction fence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates entries only for tournament documents fenced as still open', async () => {
    const openId = new Types.ObjectId();
    const completedId = new Types.ObjectId();
    mockedEntry.distinct.mockReturnValue({
      session: jest.fn().mockResolvedValue([openId, completedId]),
    });
    mockedTournament.findOneAndUpdate
      .mockResolvedValueOnce({ _id: openId })
      .mockResolvedValueOnce(null);
    mockedEntry.updateMany.mockResolvedValue({ modifiedCount: 1 });
    const session = { id: 'session' } as never;

    await expect(
      refreshOpenCompetitionEntryIdentitySnapshots(
        new Types.ObjectId(),
        { name: 'Corrected Name', logo: 'corrected.png' },
        session
      )
    ).resolves.toBe(1);

    expect(mockedTournament.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: openId,
        workflowState: { $ne: 'completed' },
      }),
      { $inc: { entryIdentityRevision: 1 } },
      expect.objectContaining({ session })
    );
    expect(mockedEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ tournamentId: { $in: [openId] } }),
      expect.any(Object),
      { session }
    );
  });

  it('detects an immutable completed snapshot that still references an old logo', async () => {
    const tournamentId = new Types.ObjectId();
    const teamId = new Types.ObjectId();
    const logoUrl = 'https://cdn.example.test/archived-logo.png';
    mockedTournament.find.mockReturnValue({
      distinct: jest.fn().mockResolvedValue([tournamentId]),
    });
    mockedEntry.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(
      completedCompetitionSnapshotReferencesLogo(teamId, logoUrl)
    ).resolves.toBe(true);

    expect(mockedTournament.find).toHaveBeenCalledWith(
      expect.objectContaining({
        formatVersion: 2,
        format: 'two_group_knockout',
        workflowState: 'completed',
      })
    );
    expect(mockedEntry.exists).toHaveBeenCalledWith({
      tournamentId: { $in: [tournamentId] },
      teamId,
      teamLogoSnapshot: logoUrl,
    });
  });
});
