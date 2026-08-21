jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    __esModule: true,
    default: { ...actual.default, startSession: jest.fn() },
  };
});

jest.mock('@/models/player.model', () => {
  const save = jest.fn();
  const Player = jest.fn().mockImplementation((data) => ({
    save: (options: unknown) => save(data, options),
  }));
  Object.assign(Player, {
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    __save: save,
  });
  return { __esModule: true, default: Player };
});

jest.mock('@/services/team-lifecycle.service', () => ({
  fenceTeamLifecycle: jest.fn().mockResolvedValue({ _id: 'team' }),
}));

import mongoose from 'mongoose';
import Player from '@/models/player.model';
import { fenceTeamLifecycle } from '@/services/team-lifecycle.service';
import {
  createPlayerInAvailableRosterSlot,
  MAX_TEAM_ROSTER_SIZE,
  planActiveRosterSlots,
  transferPlayerToAvailableRosterSlot,
} from '@/services/player-roster.service';

const mockedPlayer = Player as unknown as jest.Mock & {
  __save: jest.Mock;
  find: jest.Mock;
  findOneAndUpdate: jest.Mock;
  updateOne: jest.Mock;
};
const mockedFenceTeamLifecycle = fenceTeamLifecycle as jest.MockedFunction<
  typeof fenceTeamLifecycle
>;
const mockedStartSession = mongoose.startSession as jest.MockedFunction<
  typeof mongoose.startSession
>;

const session = {
  endSession: jest.fn().mockResolvedValue(undefined),
  withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()),
};

const mockActivePlayers = (players: Array<{ _id: string; rosterSlot?: number }>) => {
  const query = {
    select: jest.fn(),
    sort: jest.fn(),
    session: jest.fn().mockResolvedValue(players),
  };
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  mockedPlayer.find.mockReturnValue(query);
};

describe('atomic team roster slot allocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStartSession.mockResolvedValue(session as never);
    mockedFenceTeamLifecycle.mockResolvedValue({ _id: 'team' } as never);
    mockedPlayer.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockActivePlayers([]);
  });

  it('migrates active unslotted legacy players before exposing the next slot', () => {
    const plan = planActiveRosterSlots(
      Array.from({ length: 9 }, (_, index) => ({ id: `legacy-${index + 1}` }))
    );

    expect(plan.assignments).toHaveLength(9);
    expect(plan.assignments[0]).toEqual({ id: 'legacy-1', rosterSlot: 1 });
    expect(plan.availableSlot).toBe(10);
  });

  it('counts unslotted legacy players toward the hard cap', () => {
    expect(() =>
      planActiveRosterSlots(
        Array.from({ length: MAX_TEAM_ROSTER_SIZE + 1 }, (_, index) => ({
          id: `legacy-${index + 1}`,
        }))
      )
    ).toThrow(expect.objectContaining({ code: 'TEAM_ROSTER_FULL', statusCode: 409 }));
  });

  it('retries the whole fenced transaction after a unique-index collision', async () => {
    const created = { _id: 'player-2' };
    mockedPlayer.__save.mockRejectedValueOnce({ code: 11000 }).mockResolvedValueOnce(created);

    await expect(
      createPlayerInAvailableRosterSlot({ teamId: 'team-1', name: 'Ada' })
    ).resolves.toBe(created);
    expect(mockedStartSession).toHaveBeenCalledTimes(2);
    expect(mockedFenceTeamLifecycle).toHaveBeenCalledWith('team-1', expect.anything());
  });

  it('migrates legacy slots and rejects an eleventh active player without inserting', async () => {
    mockActivePlayers(
      Array.from({ length: MAX_TEAM_ROSTER_SIZE }, (_, index) => ({
        _id: `legacy-${index + 1}`,
      }))
    );

    await expect(
      createPlayerInAvailableRosterSlot({ teamId: 'team-1', name: 'Full Squad' })
    ).rejects.toMatchObject({ code: 'TEAM_ROSTER_FULL', statusCode: 409 });
    expect(mockedPlayer.updateOne).toHaveBeenCalledTimes(MAX_TEAM_ROSTER_SIZE);
    expect(mockedPlayer.__save).not.toHaveBeenCalled();
  });

  it('fences both teams and atomically allocates the destination slot during transfer', async () => {
    mockActivePlayers(
      Array.from({ length: 2 }, (_, index) => ({
        _id: `destination-${index + 1}`,
        rosterSlot: index + 1,
      }))
    );
    const transferred = { _id: 'player-1', teamId: 'team-2' };
    mockedPlayer.findOneAndUpdate.mockResolvedValue(transferred);

    await expect(
      transferPlayerToAvailableRosterSlot(
        { _id: 'player-1', teamId: 'team-1', isDeleted: false, __v: 4 },
        { teamId: 'team-2' }
      )
    ).resolves.toEqual({ player: transferred, rosterIsFull: false });
    expect(mockedFenceTeamLifecycle).toHaveBeenCalledTimes(2);
    expect(mockedPlayer.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'player-1', teamId: 'team-1', __v: 4 }),
      {
        $set: expect.objectContaining({ teamId: 'team-2', rosterSlot: 3 }),
        $inc: { competitionRosterRevision: 1, __v: 1 },
      },
      expect.objectContaining({ new: true, runValidators: true, session })
    );
  });

  it('reports a full destination without changing the player', async () => {
    mockActivePlayers(
      Array.from({ length: MAX_TEAM_ROSTER_SIZE }, (_, index) => ({
        _id: `destination-${index + 1}`,
        rosterSlot: index + 1,
      }))
    );

    await expect(
      transferPlayerToAvailableRosterSlot(
        { _id: 'player-1', teamId: 'team-1', isDeleted: false },
        { teamId: 'team-2' }
      )
    ).resolves.toEqual({ player: null, rosterIsFull: true });
    expect(mockedPlayer.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
