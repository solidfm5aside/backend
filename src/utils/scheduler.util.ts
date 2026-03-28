import logger from './logger';

export interface Pair {
  team1: string;
  team2: string;
}

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
