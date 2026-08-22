jest.mock('@/sockets/socket', () => ({
  broadcastGoal: jest.fn(),
  broadcastMatchUpdate: jest.fn(),
}));

jest.mock('@/services/standings.service', () => ({
  recalculateTournamentStats: jest.fn(),
}));

import Match, {
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import Tournament, { TournamentFormat } from '@/models/tournament.model';
import { updateMatchStatus } from '@/services/match.service';
import mongoose from 'mongoose';

describe('legacy downstream result locks', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prevents reopening an old upstream result when a downstream stage already exists', async () => {
    const session = {
      withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const existing = {
      _id: 'playoff-match',
      tournamentId: 'tournament-1',
      stage: MatchStage.PLAYOFF,
      status: MatchStatus.COMPLETED,
      scheduleStatus: MatchScheduleStatus.CONFIRMED,
      date: new Date('2025-01-01T12:00:00.000Z'),
      venue: 'Legacy Ground',
      resultLockedAt: undefined,
      bracketId: undefined,
      bracketNodeKey: undefined,
      homeTeam: { toString: () => 'home' },
      awayTeam: { toString: () => 'away' },
      __v: 1,
    };
    jest.spyOn(Match, 'findById').mockReturnValue({
      session: jest.fn().mockResolvedValue(existing),
    } as never);
    const tournamentQuery = {
      select: jest.fn(),
      session: jest.fn(),
      lean: jest.fn().mockResolvedValue({
        formatVersion: 1,
        format: TournamentFormat.LEGACY_LEAGUE,
      }),
    };
    tournamentQuery.select.mockReturnValue(tournamentQuery);
    tournamentQuery.session.mockReturnValue(tournamentQuery);
    jest.spyOn(Tournament, 'findById').mockReturnValue(tournamentQuery as never);
    jest.spyOn(Match, 'exists').mockReturnValue({
      session: jest.fn().mockResolvedValue({ _id: 'round-of-16-match' }),
    } as never);
    const updateSpy = jest.spyOn(Match, 'findOneAndUpdate');

    await expect(updateMatchStatus('playoff-match', MatchStatus.LIVE)).rejects.toThrow(
      /downstream knockout stage exists/i
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
