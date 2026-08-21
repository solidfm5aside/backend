export interface LegacyStatsEventLike {
  type: string;
  playerId?: unknown;
  teamId: unknown;
  assistPlayerId?: unknown;
}

export interface LegacyStatsMatchLike {
  status: string;
  homeTeam: unknown;
  awayTeam: unknown;
  homeScore: number;
  awayScore: number;
  events: LegacyStatsEventLike[];
}

export interface LegacyStandingSnapshot {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface LegacyPlayerStatsSnapshot {
  playerId: string;
  teamId: string;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  matchesPlayed: number;
}

const idString = (value: unknown): string => String(value);

/**
 * Builds a complete replacement snapshot. Scheduled/cancelled matches are
 * deliberately absent, so replacing persisted rows also removes stale data.
 */
export const buildLegacyTournamentStatsSnapshot = (
  matches: LegacyStatsMatchLike[]
): {
  standings: LegacyStandingSnapshot[];
  playerStats: LegacyPlayerStatsSnapshot[];
} => {
  const standings = new Map<string, Omit<LegacyStandingSnapshot, 'teamId' | 'goalDifference'>>();
  const playerStats = new Map<string, Omit<LegacyPlayerStatsSnapshot, 'playerId'>>();

  const standingFor = (teamId: string) => {
    const row = standings.get(teamId) ?? {
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    };
    standings.set(teamId, row);
    return row;
  };
  const playerStatsFor = (playerId: string, teamId: string) => {
    const row = playerStats.get(playerId) ?? {
      teamId,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      matchesPlayed: 0,
    };
    playerStats.set(playerId, row);
    return row;
  };

  for (const match of matches) {
    const homeTeamId = idString(match.homeTeam);
    const awayTeamId = idString(match.awayTeam);
    const home = standingFor(homeTeamId);
    const away = standingFor(awayTeamId);
    if (match.status !== 'live' && match.status !== 'completed') continue;

    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    if (match.homeScore > match.awayScore) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (match.awayScore > match.homeScore) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }

    for (const event of match.events) {
      if (!event.playerId) continue;
      const teamId = idString(event.teamId);
      const row = playerStatsFor(idString(event.playerId), teamId);
      if (event.type === 'goal') {
        row.goals += 1;
        if (event.assistPlayerId) {
          playerStatsFor(idString(event.assistPlayerId), teamId).assists += 1;
        }
      } else if (event.type === 'yellow_card') {
        row.yellowCards += 1;
      } else if (event.type === 'red_card') {
        row.redCards += 1;
      }
    }
  }

  return {
    standings: [...standings.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([teamId, row]) => ({
        teamId,
        ...row,
        goalDifference: row.goalsFor - row.goalsAgainst,
      })),
    playerStats: [...playerStats.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([playerId, row]) => ({ playerId, ...row })),
  };
};
