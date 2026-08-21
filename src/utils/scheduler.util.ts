import logger from './logger';

export interface Pair {
  team1: string;
  team2: string;
}

export interface GroupRoundRobinFixture extends Pair {
  leg: 1 | 2;
  round: number;
  roundSlot: number;
}

export interface GroupRoundRobinRound {
  leg: 1 | 2;
  round: number;
  byeTeamId?: string;
  fixtures: GroupRoundRobinFixture[];
}

export interface ScheduledRoundFixture<T> {
  fixture: T;
  matchDate: Date;
  dailySlot: number;
}

/**
 * Places every competition round in its own Saturday/Sunday matchweek.
 * A round may spill from Saturday to Sunday, but the following round always
 * starts on the next Saturday. This prevents fixtures from adjacent rounds
 * being packed onto the same day when the daily cap has spare capacity.
 */
export const scheduleRoundMatchweeks = <T extends { round: number }>(
  fixtures: readonly T[],
  startDate: Date,
  matchesPerDay: number
): ScheduledRoundFixture<T>[] => {
  if (!Number.isInteger(matchesPerDay) || matchesPerDay < 1) {
    throw new Error('matchesPerDay must be a positive integer.');
  }
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('A valid tournament start date is required.');
  }

  const firstSaturday = new Date(startDate);
  const daysUntilSaturday = (6 - firstSaturday.getUTCDay() + 7) % 7;
  firstSaturday.setUTCDate(firstSaturday.getUTCDate() + daysUntilSaturday);
  firstSaturday.setUTCHours(10, 0, 0, 0);

  const roundNumbers = [...new Set(fixtures.map((fixture) => fixture.round))].sort(
    (left, right) => left - right
  );

  return roundNumbers.flatMap((round, matchweekIndex) => {
    const roundFixtures = fixtures.filter((fixture) => fixture.round === round);
    if (roundFixtures.length > matchesPerDay * 2) {
      throw new Error(
        `Round ${round} has ${roundFixtures.length} fixtures, which exceeds the ` +
          `${matchesPerDay * 2}-fixture Saturday/Sunday matchweek capacity.`
      );
    }

    const matchweekSaturday = new Date(firstSaturday);
    matchweekSaturday.setUTCDate(matchweekSaturday.getUTCDate() + matchweekIndex * 7);

    return roundFixtures.map((fixture, roundIndex) => {
      const matchDate = new Date(matchweekSaturday);
      matchDate.setUTCDate(matchDate.getUTCDate() + Math.floor(roundIndex / matchesPerDay));
      return {
        fixture,
        matchDate,
        dailySlot: roundIndex % matchesPerDay,
      };
    });
  });
};

/**
 * Deterministic circle-method scheduler for a complete group round robin.
 * Odd-sized groups receive an internal BYE sentinel; BYEs are returned as
 * metadata and are never persisted as matches. A second leg mirrors every
 * first-leg fixture with home and away teams reversed.
 */
export const generateGroupRoundRobinFixtures = (
  teamIds: string[],
  legs: 1 | 2
): GroupRoundRobinRound[] => {
  if (teamIds.length < 2) {
    throw new Error('At least two teams are required for a round robin.');
  }
  if (legs !== 1 && legs !== 2) {
    throw new Error('Round-robin legs must be either 1 or 2.');
  }
  if (new Set(teamIds).size !== teamIds.length) {
    throw new Error('A team cannot appear more than once in a group.');
  }

  const rotation: Array<string | null> = [...teamIds];
  if (rotation.length % 2 !== 0) rotation.push(null);

  const roundsPerLeg = rotation.length - 1;
  const firstLeg: GroupRoundRobinRound[] = [];

  for (let roundIndex = 0; roundIndex < roundsPerLeg; roundIndex++) {
    const fixtures: GroupRoundRobinFixture[] = [];
    let byeTeamId: string | undefined;

    for (let pairIndex = 0; pairIndex < rotation.length / 2; pairIndex++) {
      const left = rotation[pairIndex];
      const right = rotation[rotation.length - 1 - pairIndex];

      if (left === null || right === null) {
        byeTeamId = left ?? right ?? undefined;
        continue;
      }

      const swapHomeAway = (roundIndex + pairIndex) % 2 === 1;
      fixtures.push({
        team1: swapHomeAway ? right : left,
        team2: swapHomeAway ? left : right,
        leg: 1,
        round: roundIndex + 1,
        roundSlot: fixtures.length + 1,
      });
    }

    firstLeg.push({
      leg: 1,
      round: roundIndex + 1,
      byeTeamId,
      fixtures,
    });

    const last = rotation.pop()!;
    rotation.splice(1, 0, last);
  }

  if (legs === 1) return firstLeg;

  const secondLeg = firstLeg.map((firstRound) => ({
    leg: 2 as const,
    round: firstRound.round + roundsPerLeg,
    byeTeamId: firstRound.byeTeamId,
    fixtures: firstRound.fixtures.map((fixture) => ({
      team1: fixture.team2,
      team2: fixture.team1,
      leg: 2 as const,
      round: fixture.round + roundsPerLeg,
      roundSlot: fixture.roundSlot,
    })),
  }));

  return [...firstLeg, ...secondLeg];
};

/**
 * Generates matches for a league phase using the Circle Method.
 * This guarantees that in each round, every team plays exactly once.
 * For 28 teams, passing numRounds=6 gives the perfect 6-match UCL subset.
 */
export const generateLeagueFixtures = (teamIds: string[], numRounds: number = 6): Pair[][] => {
  const numTeams = teamIds.length;
  if (numTeams % 2 !== 0) {
    throw new Error('Number of teams must be even for standard circle method.');
  }
  if (numRounds >= numTeams) {
    throw new Error('numRounds must be less than the number of teams.');
  }

  // Shuffle teams initially so the schedule isn't identical every season
  const teams = [...teamIds].sort(() => Math.random() - 0.5);
  const rounds: Pair[][] = [];

  for (let round = 0; round < numRounds; round++) {
    const roundPairs: Pair[] = [];
    
    // Pair opposing endpoints of the array
    for (let i = 0; i < numTeams / 2; i++) {
        roundPairs.push({
            team1: teams[i],
            team2: teams[numTeams - 1 - i]
        });
    }
    rounds.push(roundPairs);

    // Circle rotation: Keep index 0 fixed, rotate the rest completely clockwise
    const last = teams.pop()!;
    teams.splice(1, 0, last);
  }

  logger.info(`Successfully generated ${numRounds} rounds of fixtures using Circle Method.`);
  return rounds;
};
