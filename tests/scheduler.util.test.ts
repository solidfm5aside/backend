import {
  generateGroupRoundRobinFixtures,
  scheduleRoundMatchweeks,
} from '@/utils/scheduler.util';

const teams = Array.from({ length: 7 }, (_, index) => `team-${index + 1}`);

describe('generateGroupRoundRobinFixtures', () => {
  it('generates a complete deterministic single-leg schedule for seven teams', () => {
    const first = generateGroupRoundRobinFixtures(teams, 1);
    const second = generateGroupRoundRobinFixtures(teams, 1);

    expect(first).toEqual(second);
    expect(first).toHaveLength(7);
    expect(first.every((round) => round.fixtures.length === 3)).toBe(true);
    expect(first.flatMap((round) => round.fixtures)).toHaveLength(21);
    expect(new Set(first.map((round) => round.byeTeamId))).toEqual(new Set(teams));

    const appearances = new Map(teams.map((team) => [team, 0]));
    const pairKeys = new Set<string>();
    for (const fixture of first.flatMap((round) => round.fixtures)) {
      appearances.set(fixture.team1, appearances.get(fixture.team1)! + 1);
      appearances.set(fixture.team2, appearances.get(fixture.team2)! + 1);
      pairKeys.add([fixture.team1, fixture.team2].sort().join(':'));
    }

    expect([...appearances.values()]).toEqual(Array(7).fill(6));
    expect(pairKeys.size).toBe(21);
  });

  it('mirrors every first-leg fixture exactly once in the second leg', () => {
    const rounds = generateGroupRoundRobinFixtures(teams, 2);
    const fixtures = rounds.flatMap((round) => round.fixtures);
    const firstLeg = fixtures.filter((fixture) => fixture.leg === 1);
    const secondLeg = fixtures.filter((fixture) => fixture.leg === 2);

    expect(rounds).toHaveLength(14);
    expect(fixtures).toHaveLength(42);
    expect(firstLeg).toHaveLength(21);
    expect(secondLeg).toHaveLength(21);

    for (const fixture of firstLeg) {
      expect(
        secondLeg.some(
          (returnFixture) =>
            returnFixture.team1 === fixture.team2 &&
            returnFixture.team2 === fixture.team1 &&
            returnFixture.round === fixture.round + 7
        )
      ).toBe(true);
    }
  });

  it('rejects duplicate teams and invalid leg counts', () => {
    expect(() => generateGroupRoundRobinFixtures([...teams, teams[0]], 1)).toThrow(
      'cannot appear more than once'
    );
    expect(() => generateGroupRoundRobinFixtures(teams, 3 as 1)).toThrow(
      'must be either 1 or 2'
    );
  });

  it('keeps global rounds in distinct matchweek weekends without duplicate team dates', () => {
    const groupA = generateGroupRoundRobinFixtures(teams.map((team) => `A-${team}`), 1);
    const groupB = generateGroupRoundRobinFixtures(teams.map((team) => `B-${team}`), 1);
    const globalFixtures = groupA.flatMap((groupRound, index) => [
      ...groupRound.fixtures,
      ...groupB[index].fixtures,
    ]);

    const scheduled = scheduleRoundMatchweeks(
      globalFixtures,
      new Date('2026-08-21T14:00:00.000Z'),
      5
    );
    const roundWeekendStarts = new Map<number, Set<string>>();
    const teamDates = new Set<string>();

    for (const item of scheduled) {
      const date = item.matchDate.toISOString().slice(0, 10);
      const weekendStart = new Date(item.matchDate);
      if (weekendStart.getUTCDay() === 0) {
        weekendStart.setUTCDate(weekendStart.getUTCDate() - 1);
      }
      const weekend = weekendStart.toISOString().slice(0, 10);
      const weekends = roundWeekendStarts.get(item.fixture.round) ?? new Set<string>();
      weekends.add(weekend);
      roundWeekendStarts.set(item.fixture.round, weekends);

      for (const team of [item.fixture.team1, item.fixture.team2]) {
        const key = `${team}:${date}`;
        expect(teamDates.has(key)).toBe(false);
        teamDates.add(key);
      }
    }

    expect([...roundWeekendStarts.values()].every((weekends) => weekends.size === 1)).toBe(true);
    expect(
      new Set(
        [...roundWeekendStarts.values()].map((weekends) => [...weekends][0])
      ).size
    ).toBe(7);
    expect(scheduled.filter((item) => item.matchDate.getUTCDay() === 0)).toHaveLength(7);
  });

  it('rejects a daily cap that cannot fit a round into one weekend', () => {
    const fixtures = Array.from({ length: 6 }, (_, index) => ({ round: 1, index }));

    expect(() =>
      scheduleRoundMatchweeks(fixtures, new Date('2026-08-21T14:00:00.000Z'), 2)
    ).toThrow('Saturday/Sunday matchweek capacity');
  });
});
