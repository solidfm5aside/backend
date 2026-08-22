jest.mock('@/models/team.model', () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn() },
}));

jest.mock('@/models/player.model', () => ({
  __esModule: true,
  default: { countDocuments: jest.fn() },
}));

jest.mock('@/models/tournament-entry.model', () => {
  const actual = jest.requireActual('@/models/tournament-entry.model');
  return { __esModule: true, ...actual, default: { distinct: jest.fn() } };
});

jest.mock('@/models/tournament.model', () => {
  const actual = jest.requireActual('@/models/tournament.model');
  return { __esModule: true, ...actual, default: { findOne: jest.fn() } };
});

import Team from '@/models/team.model';
import Tournament from '@/models/tournament.model';
import TournamentEntry from '@/models/tournament-entry.model';
import {
  fenceTeamLifecycle,
  fenceTeamLifecycles,
  findOpenTournamentEntryForTeam,
} from '@/services/team-lifecycle.service';

const mockedTeam = Team as unknown as { findOneAndUpdate: jest.Mock };
const mockedTournament = Tournament as unknown as { findOne: jest.Mock };
const mockedEntry = TournamentEntry as unknown as { distinct: jest.Mock };

describe('team lifecycle dependency fence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes the registered, non-deleted Team inside the caller transaction', async () => {
    const select = jest.fn().mockResolvedValue({ _id: 'team-1', lifecycleRevision: 4 });
    mockedTeam.findOneAndUpdate.mockReturnValue({ select });
    const session = { id: 'session' } as never;

    await fenceTeamLifecycle('team-1', session, { registrationStatus: 'registered' });

    expect(mockedTeam.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'team-1',
        isDeleted: false,
        registrationStatus: 'registered',
      },
      { $inc: { lifecycleRevision: 1 } },
      { new: true, runValidators: true, session }
    );
    expect(select).toHaveBeenCalledWith('+lifecycleRevision');
  });

  it('fences all 14 entered teams once in deterministic ID order', async () => {
    const teamIds = [
      '507f1f77bcf86cd79943901e',
      '507f1f77bcf86cd799439015',
      '507f1f77bcf86cd79943901a',
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd79943901c',
      '507f1f77bcf86cd799439017',
      '507f1f77bcf86cd799439019',
      '507f1f77bcf86cd799439014',
      '507f1f77bcf86cd79943901d',
      '507f1f77bcf86cd799439012',
      '507f1f77bcf86cd799439018',
      '507f1f77bcf86cd799439016',
      '507f1f77bcf86cd79943901b',
      '507f1f77bcf86cd799439013',
      // A duplicate must not acquire the same document twice.
      '507f1f77bcf86cd799439011',
    ];
    mockedTeam.findOneAndUpdate.mockImplementation((filter: { _id: string }) => ({
      select: jest.fn().mockResolvedValue({ _id: filter._id }),
    }));
    const session = { id: 'publication-session' } as never;

    const fenced = await fenceTeamLifecycles(teamIds, session, {
      registrationStatus: 'registered',
    });

    const expectedIds = [...new Set(teamIds)].sort();
    expect([...fenced.keys()]).toEqual(expectedIds);
    expect(mockedTeam.findOneAndUpdate).toHaveBeenCalledTimes(14);
    expect(
      mockedTeam.findOneAndUpdate.mock.calls.map(([filter]) => filter._id)
    ).toEqual(expectedIds);
    for (const [filter, update, options] of mockedTeam.findOneAndUpdate.mock.calls) {
      expect(filter).toEqual({
        _id: expect.any(String),
        isDeleted: false,
        registrationStatus: 'registered',
      });
      expect(update).toEqual({ $inc: { lifecycleRevision: 1 } });
      expect(options).toEqual({ new: true, runValidators: true, session });
    }
  });

  it('treats an open supported competition entry as a lifecycle blocker', async () => {
    const session = { id: 'session' } as never;
    mockedEntry.distinct.mockReturnValue({
      session: jest.fn().mockResolvedValue(['tournament-1']),
    });
    const lean = jest.fn().mockResolvedValue({
      _id: { toString: () => 'tournament-1' },
      name: 'Open Competition',
    });
    const sessionQuery = jest.fn().mockReturnValue({ lean });
    mockedTournament.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ session: sessionQuery }),
    });

    await expect(findOpenTournamentEntryForTeam('team-1', session)).resolves.toEqual({
      tournamentId: 'tournament-1',
      tournamentName: 'Open Competition',
    });
    expect(mockedTournament.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        formatVersion: { $in: [2, 3] },
        format: { $in: ['two_group_knockout', 'single_table_final'] },
        workflowState: { $ne: 'completed' },
      })
    );
  });
});
