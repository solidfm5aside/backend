import Tournament, { TournamentStatus } from '@/models/tournament.model';
import Team from '@/models/team.model';
import Match, { MatchStage } from '@/models/match.model';
import Standings from '@/models/standings.model';
import Venue from '@/models/venue.model';
import { generateLeagueFixtures } from '@/utils/scheduler.util';
import logger from '@/utils/logger';
import mongoose from 'mongoose';

export const createTournament = async (data: any) => {
  return await Tournament.create(data);
};

export const getTournaments = async (query: any = {}) => {
  return await Tournament.find(query).sort({ createdAt: -1 });
};

export const updateTournament = async (id: string, data: any) => {
  return await Tournament.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

export const getTournamentArchive = async () => {
  // Find all completed tournaments
  const completedTournaments = await Tournament.find({ status: 'completed', isDeleted: false }).sort({ startDate: -1 });
  
  const archive = [];
  
  for (const tournament of completedTournaments) {
    // Find the winner from standings for each tournament
    const topTeam = await Standings.findOne({ tournamentId: tournament._id })
      .sort({ points: -1, goalDifference: -1, goalsFor: -1 })
      .populate('teamId', 'name city')
      .lean();

    archive.push({
      _id: tournament._id,
      name: tournament.name,
      season: tournament.season,
      champion: topTeam ? topTeam.teamId : null,
    });
  }

  return archive;
};

import Player from '@/models/player.model';

export const checkTournamentReadiness = async (tournamentId: string) => {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new Error('Tournament not found');

  const teams = await Team.find({ isDeleted: false });
  const is28Teams = teams.length === 28;

  let allTeamsReady = true;
  const teamStatuses = [];

  for (const team of teams) {
    const playerCount = await Player.countDocuments({ teamId: team._id, isDeleted: false });
    const isReady = playerCount >= 5;
    if (!isReady) allTeamsReady = false;
    
    teamStatuses.push({
      teamId: team._id,
      name: team.name,
      playerCount,
      isReady
    });
  }

  return {
    isReady: is28Teams && allTeamsReady,
    totalTeams: teams.length,
    is28Teams,
    allTeamsReady,
    teamStatuses
  };
};

export const generateTournamentFixtures = async (tournamentId: string, numRounds: number = 6, matchesPerDay: number = 7) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) throw new Error('Tournament not found');

    // ONE-TIME LOCK
    if (tournament.fixturesGenerated) {
      throw new Error('Fixtures have already been generated for this tournament.');
    }

    const teams = await Team.find({ isDeleted: false });
    if (teams.length < 2) throw new Error('Need at least 2 teams to generate fixtures.');

    const teamIds = teams.map(t => t._id.toString());
    const roundPairs = generateLeagueFixtures(teamIds, numRounds);
    
    // Flatten all matches into a single queue
    const allMatches = roundPairs.flat();
    
    const venues = await Venue.find({ isDeleted: false }).sort({ importance: 1 });
    if (venues.length === 0) {
      throw new Error('No venues configured. Please add a venue first.');
    }

    const getNextSaturday = (date: Date): Date => {
      const d = new Date(date);
      const day = d.getUTCDay();
      const diff = (6 - day + 7) % 7; 
      d.setUTCDate(d.getUTCDate() + diff);
      d.setUTCHours(10, 0, 0, 0); 
      return d;
    };

    const matchDocs = [];
    let currentMatchDate = getNextSaturday(new Date(tournament.startDate));
    let matchesScheduledOnCurrentDay = 0;
    let currentDayIsSaturday = true;

    // Save configuration to tournament
    tournament.leagueRounds = numRounds;
    tournament.currentStage = MatchStage.LEAGUE;
    tournament.fixturesGenerated = true;
    await tournament.save({ session });

    for (let i = 0; i < allMatches.length; i++) {
      if (matchesScheduledOnCurrentDay >= matchesPerDay) {
        matchesScheduledOnCurrentDay = 0;
        if (currentDayIsSaturday) {
          currentMatchDate.setUTCDate(currentMatchDate.getUTCDate() + 1);
          currentDayIsSaturday = false;
        } else {
          currentMatchDate.setUTCDate(currentMatchDate.getUTCDate() + 6);
          currentDayIsSaturday = true;
        }
      }

      const slotIndex = Math.floor(matchesScheduledOnCurrentDay / venues.length);
      const venueIndex = matchesScheduledOnCurrentDay % venues.length;
      
      const matchTime = new Date(currentMatchDate);
      matchTime.setUTCHours(10 + (slotIndex * 2), 0, 0, 0); 

      // Calculate which round this match belongs to (approximate based on order)
      const roundNumber = Math.floor(i / 14) + 1;

      matchDocs.push({
        tournamentId,
        homeTeam: allMatches[i].team1,
        awayTeam: allMatches[i].team2,
        date: matchTime,
        venue: venues[venueIndex].name,
        stage: MatchStage.LEAGUE,
        round: roundNumber,
        status: 'scheduled',
        events: []
      });

      matchesScheduledOnCurrentDay++;
    }



    await Match.insertMany(matchDocs, { session });

    // Initialize Standings for all teams
    const standingsDocs = teams.map(team => ({
      tournamentId,
      teamId: team._id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0
    }));

    await Standings.insertMany(standingsDocs, { session });

    // Mark fixtures as generated — permanent one-time lock
    tournament.fixturesGenerated = true;
    tournament.status = 'ongoing' as any;
    await tournament.save({ session });

    await session.commitTransaction();
    logger.info(`Generated ${matchDocs.length} fixtures for tournament ${tournamentId}`);
    return matchDocs;
  } catch (error) {
    await session.abortTransaction();
    logger.error('Fixture Generation Error:', error);
    throw error;
  } finally {
    session.endSession();
  }
};

export const generateKnockoutFixtures = async (tournamentId: string, stage: MatchStage = MatchStage.ROUND_OF_16) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) throw new Error('Tournament not found');

    // Verify all current stage matches are completed
    const pendingMatches = await Match.countDocuments({ 
      tournamentId, 
      stage: tournament.currentStage,
      status: { $ne: 'completed' },
      isDeleted: false
    });

    if (pendingMatches > 0) {
      throw new Error(`Cannot proceed to ${stage}. There are ${pendingMatches} matches pending in the ${tournament.currentStage} stage.`);
    }

    let pairs: { team1: string, team2: string }[] = [];

    if (stage === MatchStage.PLAYOFF) {
      // Get Teams 9-24 from Standings (16 teams)
      const standings = await Standings.find({ tournamentId })
        .sort({ points: -1, goalDifference: -1, goalsFor: -1 })
        .skip(8)
        .limit(16);

      if (standings.length < 16) throw new Error('Insufficient teams in standings for Playoff round');
      
      const playoffTeams = standings.map(s => s.teamId.toString());
      // Pair 9-16 (High Seeds) vs 17-24 (Unseeded)
      // 9th vs 24th, 10th vs 23rd, etc.
      for (let i = 0; i < 8; i++) {
        pairs.push({
          team1: playoffTeams[i],
          team2: playoffTeams[playoffTeams.length - 1 - i]
        });
      }
    } else if (stage === MatchStage.ROUND_OF_16) {
      // NEW UCL FORMAT: Seeds (1-8) vs Playoff Winners
      const seedsRecord = await Standings.find({ tournamentId })
        .sort({ points: -1, goalDifference: -1, goalsFor: -1 })
        .limit(8);
      
      if (seedsRecord.length < 8) throw new Error('Insufficient teams in standings for Round of 16 Seeds');
      const seeds = seedsRecord.map(s => s.teamId.toString());

      const playoffMatches = await Match.find({ tournamentId, stage: MatchStage.PLAYOFF, isDeleted: false });
      if (playoffMatches.length < 8) {
        // Fallback for older formats or testing: just take top 16
        const standings = await Standings.find({ tournamentId })
          .sort({ points: -1, goalDifference: -1, goalsFor: -1 })
          .limit(16);
        const teams = standings.map(s => s.teamId.toString());
        for (let i = 0; i < 8; i++) {
          pairs.push({ team1: teams[i], team2: teams[teams.length - 1 - i] });
        }
      } else {
        const playoffWinners = playoffMatches.map(m => {
          if (m.homeScore > m.awayScore) return m.homeTeam.toString();
          if (m.awayScore > m.homeScore) return m.awayTeam.toString();
          return m.homeTeam.toString(); // Fallback
        });

        // Pair Seeds vs Playoff Winners
        for (let i = 0; i < 8; i++) {
          pairs.push({
            team1: seeds[i],
            team2: playoffWinners[playoffWinners.length - 1 - i]
          });
        }
      }
    } else {
      // For later stages (QF, SF, Final), we take winners of the PREVIOUS stage
      const prevStage = getPreviousStage(stage);
      const prevMatches = await Match.find({ tournamentId, stage: prevStage, isDeleted: false });
      
      const winners = prevMatches.map(m => {
        if (m.homeScore > m.awayScore) return m.homeTeam.toString();
        if (m.awayScore > m.homeScore) return m.awayTeam.toString();
        return m.homeTeam.toString(); 
      });

      if (winners.length < 2) throw new Error(`Insufficient winners for ${stage}`);

      for (let i = 0; i < winners.length / 2; i++) {
        pairs.push({
          team1: winners[i],
          team2: winners[winners.length - 1 - i]
        });
      }
    }

    if (pairs.length === 0) throw new Error(`Could not determine matches for ${stage}`);

    const venues = await Venue.find({ isDeleted: false }).sort({ importance: 1 });
    const lastMatch = await Match.findOne({ tournamentId, isDeleted: false }).sort({ date: -1 });
    const nextDate = new Date(lastMatch ? lastMatch.date : tournament.startDate);
    
    // Find next Saturday
    const day = nextDate.getUTCDay();
    const diff = (6 - day + 7) % 7 || 7; 
    nextDate.setUTCDate(nextDate.getUTCDate() + diff);
    nextDate.setUTCHours(10, 0, 0, 0);

    const matchDocs = pairs.map((pair, idx) => {
      const isSaturday = idx < pairs.length / 2;
      const mDate = new Date(nextDate);
      if (!isSaturday) mDate.setUTCDate(mDate.getUTCDate() + 1); 

      const slotIdx = isSaturday ? idx : (idx - Math.floor(pairs.length / 2));
      mDate.setUTCHours(10 + (slotIdx * 2), 0, 0, 0);

      return {
        tournamentId,
        homeTeam: pair.team1,
        awayTeam: pair.team2,
        date: mDate,
        venue: venues[slotIdx % venues.length]?.name || 'Main Court',
        stage: stage,
        status: 'scheduled',
        events: []
      };
    });

    await Match.insertMany(matchDocs, { session });
    
    tournament.currentStage = stage;
    await tournament.save({ session });

    await session.commitTransaction();
    return matchDocs;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getPreviousStage = (stage: MatchStage): MatchStage => {
  switch (stage) {
    case MatchStage.PLAYOFF: return MatchStage.LEAGUE;
    case MatchStage.ROUND_OF_16: return MatchStage.PLAYOFF;
    case MatchStage.QUARTER_FINALS: return MatchStage.ROUND_OF_16;
    case MatchStage.SEMI_FINALS: return MatchStage.QUARTER_FINALS;
    case MatchStage.FINAL: return MatchStage.SEMI_FINALS;
    default: return MatchStage.LEAGUE;
  }
};
