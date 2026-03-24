import Tournament from '@/models/tournament.model';
import Team from '@/models/team.model';
import Match from '@/models/match.model';
import Standings from '@/models/standings.model';
import { generateLeagueFixtures } from '@/utils/scheduler.util';
import logger from '@/utils/logger';
import mongoose from 'mongoose';

export const createTournament = async (data: any) => {
  return await Tournament.create(data);
};

export const generateTournamentFixtures = async (tournamentId: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) throw new Error('Tournament not found');

    // For this specific system, we assume 28 teams are expected
    const teams = await Team.find({ isDeleted: false });
    if (teams.length < 28) {
      throw new Error(`Insufficient teams to generate fixtures. Need 28, found ${teams.length}`);
    }

    const teamIds = teams.map(t => t._id.toString());
    const fixtures = generateLeagueFixtures(teamIds, 6);

    // Create Match documents
    const matchDocs = fixtures.map(pair => ({
      tournamentId,
      homeTeam: pair.team1,
      awayTeam: pair.team2,
      date: tournament.startDate, // Default to start date, admin can manually adjust later
      status: 'scheduled',
      events: []
    }));

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
