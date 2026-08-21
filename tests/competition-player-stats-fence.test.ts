jest.mock('@/models/player-stats.model', () => ({
  __esModule: true,
  default: {
    bulkWrite: jest.fn(),
    deleteMany: jest.fn(),
  },
}));

import { Types } from 'mongoose';
import PlayerStats from '@/models/player-stats.model';
import { persistCompetitionPlayerStats } from '@/services/competition.service';

const mockedPlayerStats = PlayerStats as unknown as {
  bulkWrite: jest.Mock;
  deleteMany: jest.Mock;
};

describe('v2 player-stat rebuild revision fence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes and prunes only within the caller transaction and revision', async () => {
    const tournamentId = new Types.ObjectId().toString();
    const playerId = new Types.ObjectId().toString();
    const teamId = new Types.ObjectId().toString();
    const session = { id: 'rebuild-session' } as never;
    const attachSession = jest.fn().mockResolvedValue({ deletedCount: 1 });
    mockedPlayerStats.bulkWrite.mockResolvedValue({});
    mockedPlayerStats.deleteMany.mockReturnValue({ session: attachSession });

    await persistCompetitionPlayerStats(
      tournamentId,
      [
        {
          status: 'completed',
          events: [{ type: 'goal', playerId, teamId }],
        },
      ],
      12,
      session
    );

    expect(mockedPlayerStats.bulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: expect.objectContaining({
              tournamentId: new Types.ObjectId(tournamentId),
              playerId: new Types.ObjectId(playerId),
              $or: [
                { revision: { $exists: false } },
                { revision: { $lte: 12 } },
              ],
            }),
            update: expect.objectContaining({
              $set: expect.objectContaining({ revision: 12, goals: 1 }),
            }),
            upsert: true,
          }),
        }),
      ],
      { session }
    );
    expect(mockedPlayerStats.deleteMany).toHaveBeenCalledWith({
      tournamentId: new Types.ObjectId(tournamentId),
      $or: [
        { revision: { $exists: false } },
        { revision: { $lt: 12 } },
      ],
    });
    expect(attachSession).toHaveBeenCalledWith(session);
  });
});
