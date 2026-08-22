import {
  buildCompetitionPlayerStatsSnapshot,
  buildKnockoutBracketPlan,
  buildStandingRankPersistenceRows,
  buildStandingsRevisionGuard,
  deriveKnockoutProgression,
  getFirstKnockoutStage,
  getMissingCompetitionDecisions,
  hasUnresolvedQualificationTie,
  isCompetitionCompletionSatisfied,
  isPowerOfTwo,
  isValidKnockoutScoreWinner,
  nextStandingsRevision,
  rankFixedCompetitionGroup,
  rankStandings,
  selectCompetitionTeamIdentity,
  validateResolvedKnockoutRound,
  withBracketNodeTeamIdentities,
} from '@/utils/competition.util';

describe('competition invariants', () => {
  it('keeps every unconfirmed decision visibly blocking', () => {
    expect(getMissingCompetitionDecisions()).toEqual([
      'roundRobinLegs',
      'qualifiersPerGroup',
      'tieBreakers',
      'drawMode',
      'avoidSameGroupFirstRound',
      'thirdPlaceMatch',
      'maxRosterPlayers',
    ]);
    expect(
      getMissingCompetitionDecisions({
        roundRobinLegs: 1,
        qualifiersPerGroup: 4,
        tieBreakers: [
          'points',
          'goal_difference',
          'goals_for',
          'head_to_head',
          'committee_decision',
        ],
        drawMode: 'seeded_cross_group',
        avoidSameGroupFirstRound: true,
        thirdPlaceMatch: false,
        maxRosterPlayers: 10,
      })
    ).toEqual([]);
  });

  it('accepts only directly supported power-of-two knockout entry sizes', () => {
    expect(isPowerOfTwo(8)).toBe(true);
    expect(isPowerOfTwo(6)).toBe(false);
    expect(getFirstKnockoutStage(8)).toBe('quarter_finals');
    expect(getFirstKnockoutStage(4)).toBe('semi_finals');
    expect(getFirstKnockoutStage(6)).toBeNull();
  });

  it('ranks only by configured rules and detects a cutoff tie', () => {
    const ranked = rankStandings(
      [
        { points: 10, goalDifference: 3, goalsFor: 6, groupSlot: 1 },
        { points: 7, goalDifference: 1, goalsFor: 5, groupSlot: 2 },
        { points: 7, goalDifference: 1, goalsFor: 5, groupSlot: 3 },
        { points: 4, goalDifference: -2, goalsFor: 2, groupSlot: 4 },
      ],
      ['points', 'goal_difference', 'goals_for']
    );

    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
    expect(
      hasUnresolvedQualificationTie(
        ranked,
        2,
        ['points', 'goal_difference', 'goals_for']
      )
    ).toBe(true);
  });

  it('defines durable bracket adjacency without selecting any physical pairings', () => {
    const bracket = buildKnockoutBracketPlan(8, false);
    expect(
      bracket
        .filter((node) => node.stage === 'semi_finals')
        .map((node) => [node.homeSource.sourceNodeKey, node.awaySource.sourceNodeKey])
    ).toEqual([
      ['quarter_finals:1', 'quarter_finals:2'],
      ['quarter_finals:3', 'quarter_finals:4'],
    ]);
    expect(
      bracket
        .filter((node) => node.stage === 'final')
        .map((node) => [node.homeSource.sourceNodeKey, node.awaySource.sourceNodeKey])
    ).toEqual([['semi_finals:1', 'semi_finals:2']]);
    expect(bracket.some((node) => node.stage === 'third_place')).toBe(false);
  });

  it('uses only a completed direct result to separate a two-team primary tie', () => {
    const result = rankFixedCompetitionGroup(
      [
        { teamId: 'team-a', points: 10, goalDifference: 4, goalsFor: 8 },
        { teamId: 'team-b', points: 10, goalDifference: 4, goalsFor: 8 },
      ],
      {
        groupKey: 'A',
        teamIdOf: (row) => row.teamId,
        matches: [
          {
            homeTeamId: 'team-a',
            awayTeamId: 'team-b',
            homeScore: 1,
            awayScore: 2,
            fixtureKey: 'direct',
          },
        ],
      }
    );

    expect(result.rows.map((row) => [row.teamId, row.rank])).toEqual([
      ['team-b', 1],
      ['team-a', 2],
    ]);
    expect(result.unresolvedTies).toEqual([]);
  });

  it('leaves a drawn direct match and every three-team tie for committee resolution', () => {
    const twoTeam = rankFixedCompetitionGroup(
      [
        { teamId: 'team-a', points: 10, goalDifference: 4, goalsFor: 8 },
        { teamId: 'team-b', points: 10, goalDifference: 4, goalsFor: 8 },
      ],
      {
        groupKey: 'A',
        teamIdOf: (row) => row.teamId,
        matches: [
          {
            homeTeamId: 'team-a',
            awayTeamId: 'team-b',
            homeScore: 1,
            awayScore: 1,
          },
        ],
      }
    );
    expect(twoTeam.rows.map((row) => row.rank)).toEqual([1, 1]);
    expect(twoTeam.unresolvedTies[0]).toEqual(
      expect.objectContaining({ startRank: 1, endRank: 2, resolved: false })
    );
    expect(twoTeam.unresolvedTies[0].basisHash).toMatch(/^[0-9a-f]{64}$/);

    const threeTeam = rankFixedCompetitionGroup(
      ['team-a', 'team-b', 'team-c'].map((teamId) => ({
        teamId,
        points: 10,
        goalDifference: 4,
        goalsFor: 8,
      })),
      {
        groupKey: 'A',
        teamIdOf: (row) => row.teamId,
        matches: [
          { homeTeamId: 'team-a', awayTeamId: 'team-b', homeScore: 4, awayScore: 0 },
          { homeTeamId: 'team-a', awayTeamId: 'team-c', homeScore: 3, awayScore: 0 },
        ],
      }
    );
    expect(threeTeam.rows.map((row) => row.rank)).toEqual([1, 1, 1]);
    expect(threeTeam.unresolvedTies[0].teamIds).toEqual([
      'team-a',
      'team-b',
      'team-c',
    ]);
  });

  it('applies only an exact basis-hashed committee order and marks top-four ties blocking', () => {
    const rows = [
      { teamId: 'first', points: 12, goalDifference: 5, goalsFor: 10 },
      { teamId: 'second', points: 10, goalDifference: 3, goalsFor: 8 },
      { teamId: 'third', points: 8, goalDifference: 1, goalsFor: 6 },
      { teamId: 'fourth', points: 8, goalDifference: 1, goalsFor: 6 },
      { teamId: 'fifth', points: 4, goalDifference: -2, goalsFor: 3 },
    ];
    const unresolved = rankFixedCompetitionGroup(rows, {
      groupKey: 'B',
      teamIdOf: (row) => row.teamId,
      matches: [
        { homeTeamId: 'third', awayTeamId: 'fourth', homeScore: 0, awayScore: 0 },
      ],
    });
    const tie = unresolved.unresolvedTies[0];
    expect(tie).toEqual(
      expect.objectContaining({
        startRank: 3,
        endRank: 4,
        affectsQualificationOrSeeding: true,
      })
    );

    const resolved = rankFixedCompetitionGroup(rows, {
      groupKey: 'B',
      teamIdOf: (row) => row.teamId,
      matches: [
        { homeTeamId: 'third', awayTeamId: 'fourth', homeScore: 0, awayScore: 0 },
      ],
      resolutions: [
        {
          groupKey: 'B',
          basisHash: tie.basisHash,
          tiedTeamIds: tie.teamIds,
          orderedTeamIds: ['fourth', 'third'],
          method: 'coin_toss',
        },
      ],
    });
    expect(resolved.rows.slice(2, 4).map((row) => [row.teamId, row.rank])).toEqual([
      ['fourth', 3],
      ['third', 4],
    ]);
    expect(
      buildStandingRankPersistenceRows(resolved.rows, (row) => row.teamId)
        .slice(2, 4)
        .map(({ teamId, rank }) => [teamId, rank])
    ).toEqual([
      ['fourth', 3],
      ['third', 4],
    ]);
    expect(resolved.ties[0].resolved).toBe(true);
    expect(resolved.unresolvedTies).toEqual([]);
  });

  it('blocks tied first seeds but not ties wholly below fourth place', () => {
    const result = rankFixedCompetitionGroup(
      [
        { teamId: 'a', points: 10, goalDifference: 3, goalsFor: 7 },
        { teamId: 'b', points: 10, goalDifference: 3, goalsFor: 7 },
        { teamId: 'c', points: 8, goalDifference: 2, goalsFor: 5 },
        { teamId: 'd', points: 7, goalDifference: 1, goalsFor: 4 },
        { teamId: 'e', points: 4, goalDifference: -1, goalsFor: 3 },
        { teamId: 'f', points: 4, goalDifference: -1, goalsFor: 3 },
      ],
      {
        groupKey: 'A',
        teamIdOf: (row) => row.teamId,
        matches: [
          { homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 1 },
          { homeTeamId: 'e', awayTeamId: 'f', homeScore: 0, awayScore: 0 },
        ],
      }
    );
    expect(result.unresolvedTies.map((tie) => tie.affectsQualificationOrSeeding)).toEqual([
      true,
      false,
    ]);
  });

  it('uses current team identity while active and preserves the completed snapshot', () => {
    const snapshot = { name: 'Original Name', logo: 'old.png' };
    const current = { name: 'Corrected Name', logo: 'new.png' };
    expect(selectCompetitionTeamIdentity(snapshot, current, false)).toEqual(current);
    expect(selectCompetitionTeamIdentity(snapshot, current, true)).toEqual(snapshot);
  });

  it('allocates a standings revision newer than both workflow and prior rebuilds', () => {
    expect(nextStandingsRevision(3, 8)).toBe(9);
    expect(nextStandingsRevision(12, 8)).toBe(13);
    expect(buildStandingsRevisionGuard(13)).toEqual({
      $or: [
        { revision: { $exists: false } },
        { revision: { $lte: 13 } },
      ],
    });
  });

  it('rebuilds v2 player stats from one snapshot and drops removed or inactive events', () => {
    const snapshot = buildCompetitionPlayerStatsSnapshot([
      {
        status: 'completed',
        events: [
          { type: 'goal', playerId: 'p2', assistPlayerId: 'p1', teamId: 'team-a' },
          { type: 'yellow_card', playerId: 'p1', teamId: 'team-a' },
          { type: 'red_card', playerId: 'p2', teamId: 'team-a' },
        ],
      },
      {
        status: 'cancelled',
        events: [{ type: 'goal', playerId: 'stale', teamId: 'team-b' }],
      },
    ]);

    expect(snapshot).toEqual([
      {
        playerId: 'p1',
        teamId: 'team-a',
        goals: 0,
        assists: 1,
        yellowCards: 1,
        redCards: 0,
        matchesPlayed: 0,
      },
      {
        playerId: 'p2',
        teamId: 'team-a',
        goals: 1,
        assists: 0,
        yellowCards: 0,
        redCards: 1,
        matchesPlayed: 0,
      },
    ]);
    expect(snapshot.some((row) => row.playerId === 'stale')).toBe(false);
  });

  it('replaces populated match identities with durable bracket-node identities', () => {
    expect(
      withBracketNodeTeamIdentities(
        {
          _id: 'match-1',
          homeTeam: { _id: 'a', name: 'Renamed after completion' },
          awayTeam: { _id: 'b', name: 'Other current name' },
          winner: { _id: 'a', name: 'Renamed after completion' },
        },
        {
          homeTeam: { _id: 'a', name: 'Archived A' },
          awayTeam: { _id: 'b', name: 'Archived B' },
          winner: { _id: 'a', name: 'Archived A' },
        }
      )
    ).toEqual({
      _id: 'match-1',
      homeTeam: { _id: 'a', name: 'Archived A' },
      awayTeam: { _id: 'b', name: 'Archived B' },
      winner: { _id: 'a', name: 'Archived A' },
    });
  });

  it('progresses an eight-team bracket through durable adjacent slots', () => {
    const nodes = buildKnockoutBracketPlan(8, false);
    const quarterFinals = Array.from({ length: 4 }, (_, index) => ({
      nodeKey: `quarter_finals:${index + 1}`,
      status: 'completed',
      homeTeamId: `q${index + 1}h`,
      awayTeamId: `q${index + 1}a`,
      winnerTeamId: `q${index + 1}h`,
    }));
    const semiPlan = deriveKnockoutProgression(nodes, 'quarter_finals', quarterFinals);
    expect(semiPlan.kind).toBe('materialize');
    if (semiPlan.kind !== 'materialize') throw new Error('Expected semifinal plan');
    expect(semiPlan.fixtures.map((fixture) => [fixture.homeTeamId, fixture.awayTeamId])).toEqual([
      ['q1h', 'q2h'],
      ['q3h', 'q4h'],
    ]);

    const semiResults = semiPlan.fixtures.map((fixture) => ({
      nodeKey: fixture.nodeKey,
      status: 'completed',
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      winnerTeamId: fixture.homeTeamId,
    }));
    const finalPlan = deriveKnockoutProgression(nodes, 'semi_finals', semiResults);
    expect(finalPlan.kind).toBe('materialize');
    if (finalPlan.kind !== 'materialize') throw new Error('Expected final plan');
    expect(finalPlan.fixtures).toEqual([
      expect.objectContaining({
        nodeKey: 'final:1',
        homeTeamId: 'q1h',
        awayTeamId: 'q3h',
      }),
    ]);
  });

  it('progresses four entrants to a final and creates semifinal-loser third place', () => {
    const nodes = buildKnockoutBracketPlan(4, true);
    const results = [
      {
        nodeKey: 'semi_finals:1',
        status: 'completed',
        homeTeamId: 'a',
        awayTeamId: 'b',
        winnerTeamId: 'a',
      },
      {
        nodeKey: 'semi_finals:2',
        status: 'completed',
        homeTeamId: 'c',
        awayTeamId: 'd',
        winnerTeamId: 'd',
      },
    ];

    const progression = deriveKnockoutProgression(nodes, 'semi_finals', results);
    expect(progression.kind).toBe('materialize');
    if (progression.kind !== 'materialize') throw new Error('Expected materialization');
    expect(progression.fixtures).toEqual([
      expect.objectContaining({ nodeKey: 'final:1', homeTeamId: 'a', awayTeamId: 'd' }),
      expect.objectContaining({ nodeKey: 'third_place:1', homeTeamId: 'b', awayTeamId: 'c' }),
    ]);
    expect(() =>
      deriveKnockoutProgression(nodes, 'semi_finals', results, ['final:1'])
    ).toThrow('already been materialized');
  });

  it('rejects incomplete and invalid knockout results', () => {
    const nodes = buildKnockoutBracketPlan(4, false).filter(
      (node) => node.stage === 'semi_finals'
    );
    expect(() =>
      validateResolvedKnockoutRound(nodes, [
        {
          nodeKey: 'semi_finals:1',
          status: 'scheduled',
          homeTeamId: 'a',
          awayTeamId: 'b',
          winnerTeamId: 'a',
        },
        {
          nodeKey: 'semi_finals:2',
          status: 'completed',
          homeTeamId: 'c',
          awayTeamId: 'd',
          winnerTeamId: 'c',
        },
      ])
    ).toThrow('must be completed');
    expect(() =>
      validateResolvedKnockoutRound(nodes, [
        {
          nodeKey: 'semi_finals:1',
          status: 'completed',
          homeTeamId: 'a',
          awayTeamId: 'b',
          winnerTeamId: 'outsider',
        },
        {
          nodeKey: 'semi_finals:2',
          status: 'completed',
          homeTeamId: 'c',
          awayTeamId: 'd',
          winnerTeamId: 'c',
        },
      ])
    ).toThrow('validated participating winner');
    expect(
      isValidKnockoutScoreWinner({
        homeTeamId: 'a',
        awayTeamId: 'b',
        homeScore: 1,
        awayScore: 1,
        winnerTeamId: 'a',
      })
    ).toBe(false);
    expect(
      isValidKnockoutScoreWinner({
        homeTeamId: 'a',
        awayTeamId: 'b',
        homeScore: 1,
        awayScore: 1,
        winnerTeamId: 'b',
        shootoutScore: { home: 3, away: 4 },
      })
    ).toBe(true);
    expect(
      isValidKnockoutScoreWinner({
        homeTeamId: 'a',
        awayTeamId: 'b',
        homeScore: 2,
        awayScore: 1,
        winnerTeamId: 'b',
      })
    ).toBe(false);
  });

  it('returns a final champion without requiring a third-place result', () => {
    const nodes = buildKnockoutBracketPlan(4, true);
    const progression = deriveKnockoutProgression(nodes, 'final', [
      {
        nodeKey: 'final:1',
        status: 'completed',
        homeTeamId: 'finalist-a',
        awayTeamId: 'finalist-b',
        winnerTeamId: 'finalist-b',
      },
    ]);

    expect(progression).toEqual(
      expect.objectContaining({
        kind: 'complete',
        championTeamId: 'finalist-b',
        runnerUpTeamId: 'finalist-a',
      })
    );
  });

  it('keeps a third-place competition open after the champion is known', () => {
    expect(isCompetitionCompletionSatisfied(false, false)).toBe(true);
    expect(isCompetitionCompletionSatisfied(true, false)).toBe(false);
    expect(isCompetitionCompletionSatisfied(true, true)).toBe(true);
  });
});
