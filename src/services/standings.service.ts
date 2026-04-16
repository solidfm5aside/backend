import Standings from '@/models/standings.model';
import PlayerStats from '@/models/player-stats.model';
import Match from '@/models/match.model';
import Tournament from '@/models/tournament.model';
import logger from '@/utils/logger';

/**
 * Completely recalculates all stats for a tournament based on match data and events.
 * This effectively makes standings and player stats "Live" if live matches are included.
 */
export const recalculateTournamentStats = async (tournamentId: string) => {
  try {
    // 1. Fetch all matches that are not scheduled (i.e., live or completed)
    const matches = await Match.find({ 
      tournamentId, 
      isDeleted: false,
      status: { $in: ['live', 'completed'] } 
    });

    // 2. Clear existing team standings and player stats for this tournament or reset them
    // We update them in a map and then save to ensure consistency
    const teamStatsMap = new Map();
    const playerStatsMap = new Map();

    // Initialize all participating teams' standings to 0 (to handle teams that haven't played yet)
    // We'll fetch teams later if needed, but for now we focus on teams that HAVE played/are playing
    
    for (const match of matches) {
      const { homeTeam, awayTeam, homeScore, awayScore, events } = match;

      // Update Team Stats
      const updateTeam = (teamId: string, gf: number, ga: number) => {
        const idStr = teamId.toString();
        const stats = teamStatsMap.get(idStr) || { 
          played: 0, won: 0, drawn: 0, lost: 0, 
          goalsFor: 0, goalsAgainst: 0, points: 0 
        };

        stats.played += 1;
        stats.goalsFor += gf;
        stats.goalsAgainst += ga;
        
        if (gf > ga) { stats.won += 1; stats.points += 3; }
        else if (gf === ga) { stats.drawn += 1; stats.points += 1; }
        else { stats.lost += 1; }

        teamStatsMap.set(idStr, stats);
      };

      updateTeam(homeTeam.toString(), homeScore, awayScore);
      updateTeam(awayTeam.toString(), awayScore, homeScore);

      // Update Player Stats from events
      for (const event of events) {
        if (!event.playerId) continue;
        const pId = event.playerId.toString();
        const pStats = playerStatsMap.get(pId) || { goals: 0, assists: 0, yellowCards: 0, redCards: 0, teamId: event.teamId.toString() };

        if (event.type === 'goal') {
          pStats.goals += 1;
          
          // Handle Assist
          if (event.details?.includes('assist:') || (event as any).assistPlayerId) {
             const aId = (event as any).assistPlayerId?.toString();
             if (aId) {
                const aStats = playerStatsMap.get(aId) || { goals: 0, assists: 0, yellowCards: 0, redCards: 0, teamId: event.teamId.toString() };
                aStats.assists += 1;
                playerStatsMap.set(aId, aStats);
             }
          }
        } 
        else if (event.type === 'yellow_card') pStats.yellowCards += 1;
        else if (event.type === 'red_card') pStats.redCards += 1;

        playerStatsMap.set(pId, pStats);
      }
    }


    // 3. Batch Update Standings
    for (const [teamId, stats] of teamStatsMap.entries()) {
      await Standings.findOneAndUpdate(
        { tournamentId, teamId },
        { 
          ...stats,
          goalDifference: stats.goalsFor - stats.goalsAgainst
        },
        { upsert: true }
      );
    }

    // 4. Batch Update PlayerStats
    for (const [playerId, stats] of playerStatsMap.entries()) {
      await PlayerStats.findOneAndUpdate(
        { tournamentId, playerId },
        { 
          goals: stats.goals,
          assists: stats.assists,
          yellowCards: stats.yellowCards,
          redCards: stats.redCards,
          teamId: stats.teamId
        },
        { upsert: true }
      );
    }


    logger.info(`Recalculated stats for tournament ${tournamentId}`);
  } catch (error) {
    logger.error(`Error recalculating stats for tournament ${tournamentId}:`, error);
    throw error;
  }
};

export const getTournamentStandings = async (tournamentId: string) => {
  return await Standings.find({ tournamentId })
    .populate('teamId', 'name logo')
    .sort({ points: -1, goalDifference: -1, goalsFor: -1 });
};

export const getTopScorers = async (tournamentId: string) => {
  return await PlayerStats.find({ tournamentId })
    .populate('playerId', 'name')
    .populate('teamId', 'name logo')
    .sort({ goals: -1, assists: -1 })
    .limit(10);
};

export const getGlobalTournamentStandings = async () => {
  const tournaments = await Tournament.find({ isDeleted: false, status: { $ne: 'scheduled' } })
    .sort({ createdAt: -1 });

  const result = [];
  for (const t of tournaments) {
    const stats = await getTournamentStandings(t._id.toString());
    result.push({
      tournamentId: t,
      stats: stats
    });
  }
  return result;
};

export const getGlobalTopScorers = async () => {
  const tournament = await Tournament.findOne({ isDeleted: false, status: { $ne: 'scheduled' } })
    .sort({ createdAt: -1 });

  if (!tournament) return [];
  return await getTopScorers(tournament._id.toString());
};


