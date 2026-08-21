import {
  buildTournamentRosterSnapshotRows,
  findTournamentRosterLimitViolations,
  isPlayerTeamTransfer,
} from '@/utils/roster.util';

describe('tournament roster snapshot invariants', () => {
  const capturedAt = new Date('2026-08-21T10:00:00.000Z');
  const entries = [
    { id: 'entry-a', teamId: 'team-a' },
    { id: 'entry-b', teamId: 'team-b' },
  ];

  it('captures immutable season identity without inventing a minimum roster size', () => {
    expect(
      buildTournamentRosterSnapshotRows('tournament', 8, entries, [], capturedAt)
    ).toEqual([]);

    expect(
      buildTournamentRosterSnapshotRows(
        'tournament',
        8,
        entries,
        [
          {
            id: 'player-a',
            teamId: 'team-a',
            name: 'Player A',
            position: 'FW',
            jerseyNumber: 9,
            nationality: 'NG',
            photo: 'https://cdn.example.test/player-a.png',
          },
        ],
        capturedAt
      )
    ).toEqual([
      {
        tournamentId: 'tournament',
        tournamentEntryId: 'entry-a',
        teamId: 'team-a',
        playerId: 'player-a',
        playerNameSnapshot: 'Player A',
        positionSnapshot: 'FW',
        jerseyNumberSnapshot: 9,
        nationalitySnapshot: 'NG',
        photoSnapshot: 'https://cdn.example.test/player-a.png',
        publicationRevision: 8,
        capturedAt,
      },
    ]);
  });

  it('allows ten registered players and reports an actionable eleven-player violation', () => {
    const tenPlayers = Array.from({ length: 10 }, () => ({ teamId: 'team-a' }));
    expect(findTournamentRosterLimitViolations(entries, tenPlayers, 10)).toEqual([]);

    expect(
      findTournamentRosterLimitViolations(
        entries,
        [...tenPlayers, { teamId: 'team-a' }],
        10
      )
    ).toEqual([
      {
        tournamentEntryId: 'entry-a',
        teamId: 'team-a',
        playerCount: 11,
        maxRosterPlayers: 10,
      },
    ]);
  });

  it('rejects players whose team is outside the published entries', () => {
    expect(() =>
      buildTournamentRosterSnapshotRows(
        'tournament',
        8,
        entries,
        [
          {
            id: 'player-x',
            teamId: 'team-x',
            name: 'Player X',
            position: 'DF',
            jerseyNumber: 4,
            nationality: 'NG',
          },
        ],
        capturedAt
      )
    ).toThrow('must belong to a published tournament entry');
  });

  it('distinguishes profile edits from destructive team transfers', () => {
    expect(isPlayerTeamTransfer('team-a')).toBe(false);
    expect(isPlayerTeamTransfer('team-a', 'team-a')).toBe(false);
    expect(isPlayerTeamTransfer('team-a', 'team-b')).toBe(true);
  });
});
