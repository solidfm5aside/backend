import { createHash } from 'crypto';
import mongoose, { ClientSession, QueryFilter, Types } from 'mongoose';
import Match, {
  IMatch,
  IMatchEvent,
  MatchEventType,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import CompetitionBracket, {
  CompetitionBracketNodeKind,
} from '@/models/competition-bracket.model';
import Tournament, {
  CompetitionWorkflowState,
  TournamentFormat,
} from '@/models/tournament.model';
import Player from '@/models/player.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import TournamentEntry from '@/models/tournament-entry.model';
import { broadcastMatchUpdate, broadcastGoal } from '@/sockets/socket';
import { recalculateTournamentStats } from './standings.service';
import { isValidKnockoutScoreWinner } from '@/utils/competition.util';
import {
  canReopenCompletedMatch,
  isMatchStatusTransitionAllowed,
  MatchStatusValue,
} from '@/utils/match-transition.util';
import {
  applyCompletedCompetitionIdentitySnapshots,
  buildCompetitionIdentitySnapshotMap,
  buildCompetitionPlayerIdentitySnapshotMap,
  competitionReferenceId,
} from '@/utils/completed-competition-identity.util';
import { getNextLegacyStage } from '@/utils/legacy-knockout.util';

const isKnockoutMatch = (match: IMatch): boolean =>
  match.stage !== MatchStage.LEAGUE && match.stage !== MatchStage.GROUP_STAGE;

interface MatchEventInput {
  type: MatchEventType;
  minute: number;
  playerId: string | Types.ObjectId;
  teamId: string | Types.ObjectId;
  assistPlayerId?: string | Types.ObjectId;
  details?: string;
}

interface MatchListFilter {
  matchId?: string;
  tournamentId?: string;
  status?: MatchStatus;
  stage?: MatchStage;
  groupKey?: 'A' | 'B';
  round?: number;
  leg?: number;
}

const runMatchMutationTransaction = async <T>(
  work: (session: ClientSession) => Promise<T>
): Promise<T> => {
  const session = await mongoose.startSession();
  let result: T | undefined;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    if (result === undefined) {
      throw new Error('Match transaction completed without a result');
    }
    return result;
  } finally {
    await session.endSession();
  }
};

const eventOperationKey = (idempotencyKey?: string): string => {
  const normalized = idempotencyKey?.trim();
  if (!normalized) {
    throw new Error('Idempotency-Key header is required when recording a match event');
  }
  if (normalized.length > 200) {
    throw new Error('Idempotency-Key header must be at most 200 characters');
  }
  return createHash('sha256').update(normalized).digest('hex');
};

const loadMatchMutationState = (matchId: string, session: ClientSession) =>
  Match.findById(matchId)
    .select('+events.operationKey +deletedEventIds')
    .session(session);

const loadMatchResponse = (matchId: string, session: ClientSession) =>
  Match.findById(matchId)
    .session(session)
    .populate('homeTeam awayTeam', 'name logo')
    .populate('winner', 'name')
    .populate('events.playerId', 'name')
    .populate('events.assistPlayerId', 'name');

const sameEventPayload = (stored: IMatchEvent, requested: MatchEventInput): boolean =>
  stored.type === requested.type &&
  stored.minute === requested.minute &&
  stored.playerId.toString() === requested.playerId.toString() &&
  stored.teamId.toString() === requested.teamId.toString() &&
  (stored.assistPlayerId?.toString() ?? '') ===
    (requested.assistPlayerId?.toString() ?? '') &&
  (stored.details ?? '') === (requested.details ?? '');

const hasConsistentKnockoutWinner = (match: IMatch): boolean => {
  return isValidKnockoutScoreWinner({
    homeTeamId: match.homeTeam.toString(),
    awayTeamId: match.awayTeam.toString(),
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    winnerTeamId: match.winner?.toString(),
    shootoutScore: match.shootoutScore,
  });
};

const assertBracketResultEditable = async (
  match: IMatch,
  session?: ClientSession
): Promise<void> => {
  if (match.resultLockedAt) {
    throw new Error('This result is locked because it has already advanced the bracket');
  }
  if (!match.bracketId || !match.bracketNodeKey) {
    const tournamentQuery = Tournament.findById(match.tournamentId).select('formatVersion');
    if (session) tournamentQuery.session(session);
    const tournament = await tournamentQuery.lean();
    if (tournament?.formatVersion === 2) return;
    const nextStage = getNextLegacyStage(match.stage);
    if (
      nextStage &&
      (await Match.exists({
        tournamentId: match.tournamentId,
        stage: nextStage,
        isDeleted: false,
      }).session(session ?? null))
    ) {
      throw new Error('This result is locked because a downstream knockout stage exists');
    }
    return;
  }
  const bracketQuery = CompetitionBracket.findById(match.bracketId).select(
    'nodes championTeamId thirdPlaceTeamId'
  );
  if (session) bracketQuery.session(session);
  const bracket = await bracketQuery;
  if (!bracket) return;
  const node = bracket.nodes.find((item) => item.key === match.bracketNodeKey);
  if (!node) return;
  if (
    (node.stage === MatchStage.FINAL && bracket.championTeamId) ||
    (node.kind === CompetitionBracketNodeKind.THIRD_PLACE && bracket.thirdPlaceTeamId)
  ) {
    throw new Error('This result is locked because the bracket outcome has been recorded');
  }
  const hasMaterializedDownstream = bracket.nodes.some(
    (candidate) =>
      Boolean(candidate.matchId) &&
      (candidate.homeSource.sourceNodeKey === node.key ||
        candidate.awaySource.sourceNodeKey === node.key)
  );
  if (hasMaterializedDownstream) {
    throw new Error(
      'This result is locked because a downstream bracket match has already been materialized'
    );
  }
};

const assertGroupStageResultEditable = async (
  match: IMatch,
  session?: ClientSession
): Promise<void> => {
  if (match.stage !== MatchStage.GROUP_STAGE) return;
  if (match.resultLockedAt) {
    throw new Error('Group-stage results are locked after qualification is finalized');
  }
  const tournamentQuery = Tournament.findById(match.tournamentId).select(
    'formatVersion format workflowState'
  );
  if (session) tournamentQuery.session(session);
  const tournament = await tournamentQuery.lean();
  if (
    tournament?.formatVersion === 2 &&
    tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT &&
    tournament.workflowState !== CompetitionWorkflowState.GROUP_STAGE
  ) {
    throw new Error('Group-stage results are locked after qualification is finalized');
  }
};

const assertEventPlayersEligible = async (
  match: IMatch,
  event: {
    playerId: string | Types.ObjectId;
    assistPlayerId?: string | Types.ObjectId;
    teamId: string | Types.ObjectId;
  },
  session?: ClientSession
): Promise<void> => {
  if (
    event.assistPlayerId &&
    event.assistPlayerId.toString() === event.playerId.toString()
  ) {
    throw new Error('A player cannot assist their own goal');
  }
  const tournamentQuery = Tournament.findById(match.tournamentId).select(
    'formatVersion format'
  );
  if (session) tournamentQuery.session(session);
  const tournament = await tournamentQuery.lean();
  if (
    tournament?.formatVersion === 2 &&
    tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT
  ) {
    const requestedPlayerIds: Array<string | Types.ObjectId> = [event.playerId];
    if (event.assistPlayerId) requestedPlayerIds.push(event.assistPlayerId);
    const rosterQuery = TournamentRosterEntry.find({
      tournamentId: match.tournamentId,
      teamId: event.teamId,
      playerId: { $in: requestedPlayerIds },
    }).distinct('playerId');
    if (session) rosterQuery.session(session);
    const rosteredPlayerIds = await rosterQuery;
    const rostered = new Set(rosteredPlayerIds.map((playerId) => playerId.toString()));
    if (!rostered.has(event.playerId.toString())) {
      throw new Error('Event player is not eligible on this tournament roster');
    }
    if (event.assistPlayerId && !rostered.has(event.assistPlayerId.toString())) {
      throw new Error('Assist player is not eligible on this tournament roster');
    }
    return;
  }

  const playerQuery = Player.findOne({
    _id: event.playerId,
    teamId: event.teamId,
    isDeleted: false,
  }).select('_id');
  if (session) playerQuery.session(session);
  const player = await playerQuery;
  if (!player) throw new Error('Event player is not an active member of this team');
  if (event.assistPlayerId) {
    const assistPlayerQuery = Player.findOne({
      _id: event.assistPlayerId,
      teamId: event.teamId,
      isDeleted: false,
    }).select('_id');
    if (session) assistPlayerQuery.session(session);
    const assistPlayer = await assistPlayerQuery;
    if (!assistPlayer) throw new Error('Assist player is not an active member of this team');
  }
};

export const updateMatchStatus = async (matchId: string, status: MatchStatus) => {
  const outcome = await runMatchMutationTransaction(async (session) => {
    const existing = await Match.findById(matchId).session(session);
    if (!existing) return { match: null, changed: false };

    // A retry of an already-committed status still rebuilds derived state. It
    // can therefore repair data written by an older non-transactional server.
    if (existing.status === status) {
      await recalculateTournamentStats(existing.tournamentId.toString(), session);
      return {
        match: await existing.populate('homeTeam awayTeam', 'name logo'),
        changed: false,
      };
    }

    const isKnockout = isKnockoutMatch(existing);
    if (existing.resultLockedAt) {
      throw new Error('This match is locked because its result has already been consumed');
    }
    if (isKnockout && status === MatchStatus.COMPLETED) {
      throw new Error('Complete knockout matches through the winner endpoint');
    }

    const requestsCompletedReopen =
      existing.status === MatchStatus.COMPLETED && status === MatchStatus.LIVE;
    let completedResultIsEditable = false;
    if (requestsCompletedReopen) {
      if (existing.stage === MatchStage.GROUP_STAGE) {
        await assertGroupStageResultEditable(existing, session);
      }
      if (isKnockout) {
        await assertBracketResultEditable(existing, session);
      }
      completedResultIsEditable = true;
    }
    const allowCompletedReopen =
      requestsCompletedReopen &&
      canReopenCompletedMatch(isKnockout, completedResultIsEditable);
    if (
      !isMatchStatusTransitionAllowed(
        existing.status as MatchStatusValue,
        status as MatchStatusValue,
        allowCompletedReopen
      )
    ) {
      throw new Error(`Match status cannot transition from ${existing.status} to ${status}`);
    }

    const transitionUpdate =
      allowCompletedReopen && isKnockout
        ? {
            $set: { status, isExtraTime: false },
            $unset: { winner: 1, shootoutScore: 1 },
            $inc: { __v: 1 },
          }
        : { $set: { status }, $inc: { __v: 1 } };
    const match = await Match.findOneAndUpdate(
      {
        _id: matchId,
        status: existing.status,
        __v: existing.__v ?? 0,
        resultLockedAt: { $exists: false },
      },
      transitionUpdate,
      { new: true, runValidators: true, session }
    ).populate('homeTeam awayTeam', 'name logo');

    if (!match) {
      const current = await Match.findById(matchId).select('resultLockedAt').session(session);
      if (!current) return { match: null, changed: false };
      if (current.resultLockedAt) {
        throw new Error('This match is locked because its result has already been consumed');
      }
      throw new Error('Match state changed during this update. Refresh and retry.');
    }

    await recalculateTournamentStats(match.tournamentId.toString(), session);
    return { match, changed: true };
  });

  if (outcome.changed && outcome.match) broadcastMatchUpdate(matchId, outcome.match);
  return outcome.match;
};

export const updateMatchDetails = async (matchId: string, details: { date?: string; venue?: string }) => {
  const existing = await Match.findById(matchId);
  if (!existing) return null;
  if (
    (existing.status !== MatchStatus.SCHEDULED &&
      existing.status !== MatchStatus.CANCELLED) ||
    existing.resultLockedAt
  ) {
    throw new Error('Only scheduled or cancelled, unlocked matches can be rescheduled');
  }
  const changes: { date?: string; venue?: string } = {};
  if (details.date !== undefined) changes.date = details.date;
  if (details.venue !== undefined) changes.venue = details.venue;

  const match = await Match.findOneAndUpdate(
    {
      _id: matchId,
      status: existing.status,
      __v: existing.__v ?? 0,
      resultLockedAt: { $exists: false },
    },
    { $set: changes, $inc: { __v: 1 } },
    { new: true, runValidators: true }
  ).populate('homeTeam awayTeam', 'name logo')
   .populate('events.playerId', 'name')
   .populate('events.assistPlayerId', 'name');

  if (!match) {
    const current = await Match.findById(matchId).select('status resultLockedAt');
    if (!current) return null;
    if (
      (current.status !== MatchStatus.SCHEDULED &&
        current.status !== MatchStatus.CANCELLED) ||
      current.resultLockedAt
    ) {
      throw new Error('Only scheduled or cancelled, unlocked matches can be rescheduled');
    }
    throw new Error('Match state changed during this update. Refresh and retry.');
  }
  broadcastMatchUpdate(matchId, match);
  return match;
};

export const addMatchEvent = async (
  matchId: string,
  event: MatchEventInput,
  idempotencyKey?: string
) => {
  const operationKey = eventOperationKey(idempotencyKey);
  const outcome = await runMatchMutationTransaction(async (session) => {
    const match = await loadMatchMutationState(matchId, session);
    if (!match) throw new Error('Match not found');

    if (operationKey) {
      const existingEvent = match.events.find((item) => item.operationKey === operationKey);
      if (existingEvent) {
        if (!sameEventPayload(existingEvent, event)) {
          throw new Error('This Idempotency-Key was already used for a different match event');
        }
        const responseMatch = await loadMatchResponse(matchId, session);
        if (!responseMatch) throw new Error('Match not found');
        if (!existingEvent._id) throw new Error('Stored match event has no identifier');
        return {
          match: responseMatch,
          eventId: existingEvent._id.toString(),
          added: false,
        };
      }
    }

    if (match.status !== MatchStatus.LIVE && match.status !== MatchStatus.COMPLETED) {
      throw new Error('Start the match before recording events');
    }
    if (match.status === MatchStatus.COMPLETED) {
      await assertGroupStageResultEditable(match, session);
      if (isKnockoutMatch(match)) await assertBracketResultEditable(match, session);
    }

    const eventTeamId = event.teamId.toString();
    const isHomeTeam = eventTeamId === match.homeTeam.toString();
    const isAwayTeam = eventTeamId === match.awayTeam.toString();
    if (!isHomeTeam && !isAwayTeam) {
      throw new Error('Event team must be one of the teams in this match');
    }

    await assertEventPlayersEligible(match, event, session);
    const eventId = new Types.ObjectId();
    match.events.push({ ...event, _id: eventId, operationKey } as unknown as IMatchEvent);

    if (event.type === MatchEventType.GOAL) {
      if (isHomeTeam) {
        match.homeScore += 1;
      } else {
        match.awayScore += 1;
      }
      if (
        match.status === MatchStatus.COMPLETED &&
        isKnockoutMatch(match) &&
        !hasConsistentKnockoutWinner(match)
      ) {
        throw new Error(
          'This goal would invalidate the completed knockout winner; reopen and resolve the match first'
        );
      }
    }

    await match.save({ session });
    await recalculateTournamentStats(match.tournamentId.toString(), session);
    const responseMatch = await loadMatchResponse(matchId, session);
    if (!responseMatch) throw new Error('Match not found');
    return {
      match: responseMatch,
      eventId: eventId.toString(),
      added: true,
    };
  });

  if (outcome.added) {
    if (event.type === MatchEventType.GOAL) {
      broadcastGoal(matchId, { match: outcome.match, event });
    } else {
      broadcastMatchUpdate(matchId, outcome.match);
    }
  }
  return {
    match: outcome.match,
    eventId: outcome.eventId,
    replayed: !outcome.added,
  };
};

export const deleteMatchEvent = async (matchId: string, eventId: string) => {
  const outcome = await runMatchMutationTransaction(async (session) => {
    const match = await loadMatchMutationState(matchId, session);
    if (!match) throw new Error('Match not found');

    const eventIndex = match.events.findIndex((event) => event._id?.toString() === eventId);
    if (eventIndex === -1) {
      const wasPreviouslyDeleted = match.deletedEventIds?.some(
        (deletedEventId) => deletedEventId.toString() === eventId
      );
      if (!wasPreviouslyDeleted) throw new Error('Match event not found');
      const responseMatch = await loadMatchResponse(matchId, session);
      if (!responseMatch) throw new Error('Match not found');
      return {
        match: responseMatch,
        removed: false,
      };
    }

    const event = match.events[eventIndex];
    if (match.status === MatchStatus.COMPLETED) {
      await assertGroupStageResultEditable(match, session);
      if (isKnockoutMatch(match)) await assertBracketResultEditable(match, session);
    }

    if (event.type === MatchEventType.GOAL) {
      if (event.teamId.toString() === match.homeTeam.toString()) {
        match.homeScore = Math.max(0, match.homeScore - 1);
      } else if (event.teamId.toString() === match.awayTeam.toString()) {
        match.awayScore = Math.max(0, match.awayScore - 1);
      }
      if (
        match.status === MatchStatus.COMPLETED &&
        isKnockoutMatch(match) &&
        !hasConsistentKnockoutWinner(match)
      ) {
        throw new Error(
          'Deleting this goal would invalidate the completed knockout winner; reopen and resolve the match first'
        );
      }
    }

    match.events.splice(eventIndex, 1);
    if (event._id) {
      match.deletedEventIds = [...(match.deletedEventIds ?? []), event._id];
    }
    await match.save({ session });
    await recalculateTournamentStats(match.tournamentId.toString(), session);
    const responseMatch = await loadMatchResponse(matchId, session);
    if (!responseMatch) throw new Error('Match not found');
    return {
      match: responseMatch,
      removed: true,
    };
  });

  if (outcome.removed) broadcastMatchUpdate(matchId, outcome.match);
  return outcome.match;
};

export const getMatches = async (filter: MatchListFilter = {}) => {
  // Support filtering by stage
  const query: QueryFilter<IMatch> = { isDeleted: false };
  if (filter.matchId) query._id = filter.matchId;
  if (filter.tournamentId) query.tournamentId = filter.tournamentId;
  if (filter.status) query.status = filter.status;
  if (filter.stage) query.stage = filter.stage;
  if (filter.groupKey) query.groupKey = filter.groupKey;
  if (filter.round !== undefined) query.round = filter.round;
  if (filter.leg !== undefined) query.leg = filter.leg;

  const matches = await Match.find(query)
    .populate('homeTeam awayTeam', 'name logo')
    .populate('winner', 'name logo')
    .populate('events.playerId', 'name')
    .populate('events.assistPlayerId', 'name')
    .sort({ date: 1 })
    .lean();

  if (matches.length === 0) return matches;
  const tournamentIds = [
    ...new Set(
      matches
        .map((match) => competitionReferenceId(match.tournamentId))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const completedV2Tournaments = await Tournament.find({
    _id: { $in: tournamentIds },
    formatVersion: 2,
    format: TournamentFormat.TWO_GROUP_KNOCKOUT,
    workflowState: CompetitionWorkflowState.COMPLETED,
    isDeleted: false,
  })
    .select('_id')
    .lean();
  const completedTournamentIds = new Set(
    completedV2Tournaments.map((tournament) => tournament._id.toString())
  );
  if (completedTournamentIds.size === 0) return matches;

  const [snapshots, playerSnapshots] = await Promise.all([
    TournamentEntry.find({
      tournamentId: { $in: [...completedTournamentIds] },
      isDeleted: false,
    })
      .select('tournamentId teamId teamNameSnapshot teamLogoSnapshot')
      .lean(),
    TournamentRosterEntry.find({
      tournamentId: { $in: [...completedTournamentIds] },
    })
      .select('tournamentId playerId playerNameSnapshot')
      .lean(),
  ]);

  return applyCompletedCompetitionIdentitySnapshots(
    matches,
    completedTournamentIds,
    buildCompetitionIdentitySnapshotMap(snapshots),
    buildCompetitionPlayerIdentitySnapshotMap(playerSnapshots)
  );
};

/**
 * Explicitly sets the winner of a knockout match.
 * Call this after Extra Time and/or a Penalty Shootout.
 * @param matchId - The match to resolve
 * @param winnerId - The ObjectId of the team that advances
 * @param isExtraTime - True if the match required extra time
 * @param shootoutScore - Optional: set only when pens were needed { home: number, away: number }
 */
export const updateMatchWinner = async (
  matchId: string,
  winnerId: string,
  isExtraTime: boolean,
  shootoutScore?: { home: number; away: number }
) => {
  const outcome = await runMatchMutationTransaction(async (session) => {
    const existing = await Match.findById(matchId).session(session);
    if (!existing) throw new Error('Match not found');
    if (existing.stage === MatchStage.LEAGUE || existing.stage === MatchStage.GROUP_STAGE) {
      throw new Error('A winner can only be set for a knockout match');
    }

    const storedShootout = existing.shootoutScore;
    const sameShootout = shootoutScore
      ? storedShootout?.home === shootoutScore.home && storedShootout.away === shootoutScore.away
      : storedShootout?.home === undefined && storedShootout?.away === undefined;
    const alreadyResolved =
      existing.status === MatchStatus.COMPLETED &&
      existing.winner?.toString() === winnerId &&
      Boolean(existing.isExtraTime) === isExtraTime &&
      sameShootout;
    if (alreadyResolved) {
      await recalculateTournamentStats(existing.tournamentId.toString(), session);
      return {
        match: await existing.populate([
          { path: 'homeTeam awayTeam', select: 'name logo' },
          { path: 'winner', select: 'name' },
          { path: 'events.playerId', select: 'name' },
          { path: 'events.assistPlayerId', select: 'name' },
        ]),
        changed: false,
      };
    }

    if (existing.resultLockedAt) {
      throw new Error('This result is locked because it has already advanced the bracket');
    }
    if (existing.status !== MatchStatus.LIVE && existing.status !== MatchStatus.COMPLETED) {
      throw new Error('Start the knockout match before setting its winner');
    }
    if (existing.status === MatchStatus.COMPLETED) {
      await assertBracketResultEditable(existing, session);
    }
    const isHomeWinner = winnerId === existing.homeTeam.toString();
    const isAwayWinner = winnerId === existing.awayTeam.toString();
    if (!isHomeWinner && !isAwayWinner) {
      throw new Error('Winner must be one of the two teams in this match');
    }
    if (shootoutScore) {
      if (existing.homeScore !== existing.awayScore) {
        throw new Error('A penalty shootout can only resolve a tied knockout score');
      }
      if (
        !Number.isInteger(shootoutScore.home) ||
        !Number.isInteger(shootoutScore.away) ||
        shootoutScore.home < 0 ||
        shootoutScore.away < 0 ||
        shootoutScore.home === shootoutScore.away
      ) {
        throw new Error('Penalty shootout scores must be non-negative integers and cannot be tied');
      }
      if (
        (shootoutScore.home > shootoutScore.away && !isHomeWinner) ||
        (shootoutScore.away > shootoutScore.home && !isAwayWinner)
      ) {
        throw new Error('Winner does not match the penalty shootout score');
      }
    } else {
      if (existing.homeScore === existing.awayScore) {
        throw new Error('A tied knockout match requires a penalty shootout result');
      }
      if (
        (existing.homeScore > existing.awayScore && !isHomeWinner) ||
        (existing.awayScore > existing.homeScore && !isAwayWinner)
      ) {
        throw new Error('Winner does not match the match score');
      }
    }

    const updatePayload: {
      winner: string;
      isExtraTime: boolean;
      status: MatchStatus;
      shootoutScore?: { home: number; away: number };
    } = {
      winner: winnerId,
      isExtraTime,
      status: MatchStatus.COMPLETED,
    };
    if (shootoutScore) updatePayload.shootoutScore = shootoutScore;

    const match = await Match.findOneAndUpdate(
      {
        _id: matchId,
        status: existing.status,
        homeScore: existing.homeScore,
        awayScore: existing.awayScore,
        __v: existing.__v ?? 0,
        resultLockedAt: { $exists: false },
      },
      shootoutScore
        ? { $set: updatePayload, $inc: { __v: 1 } }
        : { $set: updatePayload, $unset: { shootoutScore: 1 }, $inc: { __v: 1 } },
      { new: true, runValidators: true, session }
    )
      .populate('homeTeam awayTeam', 'name logo')
      .populate('winner', 'name')
      .populate('events.playerId', 'name')
      .populate('events.assistPlayerId', 'name');

    if (!match) {
      const current = await Match.findById(matchId).select('resultLockedAt').session(session);
      if (current?.resultLockedAt) {
        throw new Error('This result is locked because it has already advanced the bracket');
      }
      if (!current) throw new Error('Match not found');
      throw new Error('Match result changed during winner resolution. Refresh and retry.');
    }

    await recalculateTournamentStats(match.tournamentId.toString(), session);
    return { match, changed: true };
  });

  if (outcome.changed) broadcastMatchUpdate(matchId, outcome.match);
  return outcome.match;
};
