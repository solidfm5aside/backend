import { buildLegacyTournamentStatsSnapshot } from '@/utils/legacy-stats.util';

describe('legacy derived-stat replacement', () => {
  const completedMatch = {
    status: 'completed',
    homeTeam: 'team-home',
    awayTeam: 'team-away',
    homeScore: 2,
    awayScore: 1,
    events: [
      {
        type: 'goal',
        playerId: 'scorer',
        assistPlayerId: 'assistant',
        teamId: 'team-home',
      },
      {
        type: 'yellow_card',
        playerId: 'defender',
        teamId: 'team-away',
      },
    ],
  };

  it('builds the full deterministic replacement rows from active results', () => {
    const snapshot = buildLegacyTournamentStatsSnapshot([completedMatch]);

    expect(snapshot.standings).toEqual([
      expect.objectContaining({
        teamId: 'team-away',
        played: 1,
        lost: 1,
        goalsFor: 1,
        goalsAgainst: 2,
        goalDifference: -1,
        points: 0,
      }),
      expect.objectContaining({
        teamId: 'team-home',
        played: 1,
        won: 1,
        goalsFor: 2,
        goalsAgainst: 1,
        goalDifference: 1,
        points: 3,
      }),
    ]);
    expect(snapshot.playerStats).toEqual([
      expect.objectContaining({ playerId: 'assistant', assists: 1 }),
      expect.objectContaining({ playerId: 'defender', yellowCards: 1 }),
      expect.objectContaining({ playerId: 'scorer', goals: 1 }),
    ]);
  });

  it('resets participating teams and removes player rows after the only result is cancelled', () => {
    const snapshot = buildLegacyTournamentStatsSnapshot([
      { ...completedMatch, status: 'cancelled' },
    ]);
    expect(snapshot.standings).toEqual([
      expect.objectContaining({ teamId: 'team-away', played: 0, points: 0, goalsFor: 0 }),
      expect.objectContaining({ teamId: 'team-home', played: 0, points: 0, goalsFor: 0 }),
    ]);
    expect(snapshot.playerStats).toEqual([]);
  });
});
