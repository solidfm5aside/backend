import {
  applyCompletedCompetitionIdentitySnapshots,
  applyCompletedCompetitionScorerIdentitySnapshots,
  buildCompetitionIdentitySnapshotMap,
  buildCompetitionPlayerIdentitySnapshotMap,
} from '@/utils/completed-competition-identity.util';

describe('completed competition identity snapshots', () => {
  const match = {
    _id: 'match-1',
    tournamentId: 'tournament-1',
    homeTeam: { _id: 'team-1', name: 'Renamed Home', logo: 'new-home.png' },
    awayTeam: { _id: 'team-2', name: 'Renamed Away', logo: 'new-away.png' },
    winner: { _id: 'team-2', name: 'Renamed Away', logo: 'new-away.png' },
    events: [
      {
        type: 'goal',
        playerId: { _id: 'player-1', name: 'Renamed Scorer' },
        assistPlayerId: { _id: 'player-2', name: 'Renamed Assistant' },
      },
    ],
  };
  const snapshots = buildCompetitionIdentitySnapshotMap([
    {
      tournamentId: 'tournament-1',
      teamId: 'team-1',
      teamNameSnapshot: 'Historic Home',
      teamLogoSnapshot: 'historic-home.png',
    },
    {
      tournamentId: 'tournament-1',
      teamId: 'team-2',
      teamNameSnapshot: 'Historic Away',
    },
  ]);
  const playerSnapshots = buildCompetitionPlayerIdentitySnapshotMap([
    {
      tournamentId: 'tournament-1',
      playerId: 'player-1',
      playerNameSnapshot: 'Historic Scorer',
    },
    {
      tournamentId: 'tournament-1',
      playerId: 'player-2',
      playerNameSnapshot: 'Historic Assistant',
    },
  ]);

  it('overlays completed teams and winners from immutable entry snapshots', () => {
    const [result] = applyCompletedCompetitionIdentitySnapshots(
      [match],
      new Set(['tournament-1']),
      snapshots,
      playerSnapshots
    );

    expect(result.homeTeam).toMatchObject({
      _id: 'team-1',
      name: 'Historic Home',
      logo: 'historic-home.png',
    });
    expect(result.awayTeam).toMatchObject({ _id: 'team-2', name: 'Historic Away', logo: '' });
    expect(result.winner).toMatchObject({ _id: 'team-2', name: 'Historic Away', logo: '' });
    expect(result.events[0].playerId).toMatchObject({
      _id: 'player-1',
      name: 'Historic Scorer',
    });
    expect(result.events[0].assistPlayerId).toMatchObject({
      _id: 'player-2',
      name: 'Historic Assistant',
    });
  });

  it('leaves active tournament identity untouched', () => {
    expect(
      applyCompletedCompetitionIdentitySnapshots([match], new Set(), snapshots)[0]
    ).toBe(match);
  });

  it('overlays completed scorer player and team identity from season snapshots', () => {
    const scorer = {
      tournamentId: 'tournament-1',
      playerId: 'player-1',
      teamId: 'team-1',
      goals: 8,
    };
    const [result] = applyCompletedCompetitionScorerIdentitySnapshots(
      [scorer],
      new Set(['tournament-1']),
      snapshots,
      playerSnapshots
    );

    expect(result.playerId).toEqual({ _id: 'player-1', name: 'Historic Scorer' });
    expect(result.teamId).toEqual({
      _id: 'team-1',
      name: 'Historic Home',
      logo: 'historic-home.png',
    });
    expect(
      applyCompletedCompetitionScorerIdentitySnapshots(
        [scorer],
        new Set(),
        snapshots,
        playerSnapshots
      )[0]
    ).toBe(scorer);
  });
});
