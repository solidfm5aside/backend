import Match from '@/models/match.model';
import { broadcastMatchUpdate, broadcastGoal } from '@/sockets/socket';
import { updateStandingsAfterMatch } from './standings.service';
import logger from '@/utils/logger';

export const updateMatchStatus = async (matchId: string, status: string) => {
  const match = await Match.findByIdAndUpdate(
    matchId,
    { status },
    { new: true }
  ).populate('homeTeam awayTeam', 'name');

  if (match) {
    if (status === 'completed') {
      await updateStandingsAfterMatch(matchId);
    }
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
  const populatedMatch = await Match.findById(matchId).populate('homeTeam awayTeam', 'name');

  if (event.type === 'goal') {
    broadcastGoal(matchId, { match: populatedMatch, event });
  } else {
    broadcastMatchUpdate(matchId, populatedMatch);
  }

  return populatedMatch;
};

export const getMatches = async (filter: any = {}) => {
  return await Match.find(filter)
    .populate('homeTeam awayTeam', 'name')
    .sort({ date: 1 });
};
