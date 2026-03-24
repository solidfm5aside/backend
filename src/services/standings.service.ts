import Standings from '@/models/standings.model';
import Match from '@/models/match.model';
import logger from '@/utils/logger';

export const updateStandingsAfterMatch = async (matchId: string) => {
  const match = await Match.findById(matchId);
  if (!match || match.status !== 'completed') return;

  const { tournamentId, homeTeam, awayTeam, homeScore, awayScore } = match;

  // Helper to update a single team's standing
  const updateTeamStats = async (teamId: string, goalsFor: number, goalsAgainst: number) => {
    const standing = await Standings.findOne({ tournamentId, teamId });
    if (!standing) return;

    let win = 0, draw = 0, loss = 0, points = 0;

    if (goalsFor > goalsAgainst) {
      win = 1; points = 3;
    } else if (goalsFor === goalsAgainst) {
      draw = 1; points = 1;
    } else {
      loss = 1;
    }

    standing.played += 1;
    standing.won += win;
    standing.drawn += draw;
    standing.lost += loss;
    standing.goalsFor += goalsFor;
    standing.goalsAgainst += goalsAgainst;
    standing.goalDifference = standing.goalsFor - standing.goalsAgainst;
    standing.points += points;

    await standing.save();
  };

  await updateTeamStats(homeTeam.toString(), homeScore, awayScore);
  await updateTeamStats(awayTeam.toString(), awayScore, homeScore);

  logger.info(`Updated standings for match ${matchId} (Tournament: ${tournamentId})`);
};

export const getTournamentStandings = async (tournamentId: string) => {
  return await Standings.find({ tournamentId })
    .populate('teamId', 'name logo')
    .sort({ points: -1, goalDifference: -1, goalsFor: -1 });
};
