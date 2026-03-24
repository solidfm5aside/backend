import logger from './logger';

interface Pair {
  team1: string;
  team2: string;
}

/**
 * Generates matches for a league phase where each team plays exactly `matchesPerTeam` unique opponents.
 * This uses a randomized greedy approach with retries.
 */
export const generateLeagueFixtures = (teamIds: string[], matchesPerTeam: number = 6): Pair[] => {
  const numTeams = teamIds.length;
  if (numTeams < matchesPerTeam + 1) {
    throw new Error(`At least ${matchesPerTeam + 1} teams are required for each to play ${matchesPerTeam} matches.`);
  }

  let attempt = 0;
  const maxAttempts = 100;

  while (attempt < maxAttempts) {
    attempt++;
    const pairs: Pair[] = [];
    const teamMatchCounts = new Map<string, number>();
    const teamOpponents = new Map<string, Set<string>>();

    teamIds.forEach(id => {
      teamMatchCounts.set(id, 0);
      teamOpponents.set(id, new Set());
    });

    let possible = true;
    const shuffledTeams = [...teamIds];

    for (const teamA of shuffledTeams) {
      while ((teamMatchCounts.get(teamA) || 0) < matchesPerTeam) {
        // Find potential opponents: not self, not already played, and still need matches
        const potentialOpponents = shuffledTeams.filter(teamB => 
          teamB !== teamA && 
          !teamOpponents.get(teamA)?.has(teamB) && 
          (teamMatchCounts.get(teamB) || 0) < matchesPerTeam
        );

        if (potentialOpponents.length === 0) {
          possible = false;
          break;
        }

        // Pick a random opponent
        const teamB = potentialOpponents[Math.floor(Math.random() * potentialOpponents.length)];

        // Record the pair
        pairs.push({ team1: teamA, team2: teamB });
        teamMatchCounts.set(teamA, (teamMatchCounts.get(teamA) || 0) + 1);
        teamMatchCounts.set(teamB, (teamMatchCounts.get(teamB) || 0) + 1);
        teamOpponents.get(teamA)?.add(teamB);
        teamOpponents.get(teamB)?.add(teamA);
      }
      if (!possible) break;
    }

    if (possible) {
      logger.info(`Successfully generated league fixtures after ${attempt} attempts.`);
      return pairs;
    }
  }

  throw new Error('Failed to generate a valid league schedule after maximum attempts. Try again or check constraints.');
};
