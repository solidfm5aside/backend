import Match from '@/models/match.model';
import { broadcastMatchUpdate, broadcastGoal } from '@/sockets/socket';
import { recalculateTournamentStats } from './standings.service';
import logger from '@/utils/logger';

export const updateMatchStatus = async (matchId: string, status: string) => {
  const match = await Match.findByIdAndUpdate(
    matchId,
    { status },
    { new: true }
  ).populate('homeTeam awayTeam', 'name logo');

  if (match) {
    if (status === 'live' || status === 'completed') {
      await recalculateTournamentStats(match.tournamentId.toString());
    }
    broadcastMatchUpdate(matchId, match);
  }
  return match;
};

export const updateMatchDetails = async (matchId: string, details: { date?: string; venue?: string }) => {
  const match = await Match.findByIdAndUpdate(
    matchId,
    { $set: details },
    { new: true }
  ).populate('homeTeam awayTeam', 'name logo')
   .populate('events.playerId', 'name')
   .populate('events.assistPlayerId', 'name');

  if (match) {
    broadcastMatchUpdate(matchId, match);
  }
  return match;
};

export const addMatchEvent = async (matchId: string, event: any) => {
  const match = await Match.findById(matchId);
  if (!match) throw new Error('Match not found');

  match.events.push(event);

  // If it's a goal, update matching team score
  if (event.type === 'goal') {
    if (event.teamId.toString() === match.homeTeam.toString()) {
      match.homeScore += 1;
    } else if (event.teamId.toString() === match.awayTeam.toString()) {
      match.awayScore += 1;
    }
  }

  await match.save();

  // If match is live or completed, recalculate stats
  if (match.status === 'live' || match.status === 'completed') {
    await recalculateTournamentStats(match.tournamentId.toString());
  }

  const populatedMatch = await Match.findById(matchId)
    .populate('homeTeam awayTeam', 'name logo')
    .populate('events.playerId', 'name')
    .populate('events.assistPlayerId', 'name');


  if (event.type === 'goal') {
    broadcastGoal(matchId, { match: populatedMatch, event });
  } else {
    broadcastMatchUpdate(matchId, populatedMatch);
  }

  return populatedMatch;
};

export const deleteMatchEvent = async (matchId: string, eventId: string) => {
  const match = await Match.findById(matchId);
  if (!match) throw new Error('Match not found');

  const eventIndex = match.events.findIndex((e: any) => e._id.toString() === eventId);
  if (eventIndex === -1) throw new Error('Event not found');

  const event = match.events[eventIndex];

  // If it was a goal, reverse the score
  if (event.type === 'goal') {
    if (event.teamId.toString() === match.homeTeam.toString()) {
      match.homeScore = Math.max(0, match.homeScore - 1);
    } else if (event.teamId.toString() === match.awayTeam.toString()) {
      match.awayScore = Math.max(0, match.awayScore - 1);
    }
  }

  match.events.splice(eventIndex, 1);
  await match.save();

  // Recalculate stats
  if (match.status === 'live' || match.status === 'completed') {
    await recalculateTournamentStats(match.tournamentId.toString());
  }

  const populatedMatch = await Match.findById(matchId)
    .populate('homeTeam awayTeam', 'name logo')
    .populate('events.playerId', 'name')
    .populate('events.assistPlayerId', 'name');


  broadcastMatchUpdate(matchId, populatedMatch);
  return populatedMatch;
};

export const getMatches = async (filter: any = {}) => {
  return await Match.find(filter)
    .populate('homeTeam awayTeam', 'name logo')
    .populate('events.playerId', 'name')
    .populate('events.assistPlayerId', 'name')
    .sort({ date: 1 });

};
