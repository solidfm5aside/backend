jest.mock('@/sockets/socket', () => ({
  broadcastGoal: jest.fn(),
  broadcastMatchUpdate: jest.fn(),
}));

jest.mock('@/services/standings.service', () => ({
  recalculateTournamentStats: jest.fn(),
}));

jest.mock('@/services/team-lifecycle.service', () => ({
  fenceTeamLifecycles: jest.fn(),
}));

import { createHash } from 'crypto';
import mongoose, { Types } from 'mongoose';
import Match, {
  IMatchEvent,
  MatchEventType,
  MatchFixtureSource,
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import Player from '@/models/player.model';
import Venue from '@/models/venue.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import Tournament, {
  CompetitionWorkflowState,
  TournamentFormat,
} from '@/models/tournament.model';
import CompetitionBracket, {
  CompetitionBracketNodeKind,
  CompetitionBracketSourceType,
} from '@/models/competition-bracket.model';
import {
  addMatchEvent,
  deleteMatchEvent,
  updateMatchDetails,
  updateMatchStatus,
  updateMatchWinner,
} from '@/services/match.service';
import { recalculateTournamentStats } from '@/services/standings.service';
import { broadcastGoal, broadcastMatchUpdate } from '@/sockets/socket';
import { fenceTeamLifecycles } from '@/services/team-lifecycle.service';

const mockedRecalculate = recalculateTournamentStats as jest.MockedFunction<
  typeof recalculateTournamentStats
>;
const mockedBroadcastGoal = broadcastGoal as jest.MockedFunction<typeof broadcastGoal>;
const mockedBroadcastUpdate = broadcastMatchUpdate as jest.MockedFunction<
  typeof broadcastMatchUpdate
>;
const mockedFenceTeamLifecycles = fenceTeamLifecycles as jest.MockedFunction<
  typeof fenceTeamLifecycles
>;

const queryResult = <T>(value: T) => {
  const promise = Promise.resolve(value);
  const query = {
    select: jest.fn(),
    session: jest.fn(),
    populate: jest.fn(),
    distinct: jest.fn(),
    lean: jest.fn().mockResolvedValue(value),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  query.select.mockReturnValue(query);
  query.session.mockReturnValue(query);
  query.populate.mockReturnValue(query);
  query.distinct.mockReturnValue(query);
  return query;
};

const buildSession = () => ({
  withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()),
  endSession: jest.fn().mockResolvedValue(undefined),
});

const buildMatch = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  tournamentId: new Types.ObjectId(),
  homeTeam: new Types.ObjectId(),
  awayTeam: new Types.ObjectId(),
  homeScore: 0,
  awayScore: 0,
  date: new Date('2026-08-23T11:00:00.000Z'),
  venue: 'Solid FM Arena',
  scheduleStatus: MatchScheduleStatus.CONFIRMED,
  status: MatchStatus.LIVE,
  stage: MatchStage.LEAGUE,
  events: [] as IMatchEvent[],
  deletedEventIds: [] as Types.ObjectId[],
  save: jest.fn().mockResolvedValue(undefined),
  populate: jest.fn(),
  ...overrides,
});

describe('transactional match mutations and derived statistics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRecalculate.mockResolvedValue(undefined);
    mockedFenceTeamLifecycles.mockResolvedValue(
      new Map([['available-team', { _id: 'available-team' }]]) as never
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requires a bounded idempotency key before starting an event transaction', async () => {
    const startSession = jest.spyOn(mongoose, 'startSession');
    const event = {
      type: MatchEventType.YELLOW_CARD,
      minute: 1,
      playerId: new Types.ObjectId(),
      teamId: new Types.ObjectId(),
    };

    await expect(addMatchEvent(new Types.ObjectId().toString(), event)).rejects.toThrow(
      /Idempotency-Key header is required/i
    );
    await expect(
      addMatchEvent(new Types.ObjectId().toString(), event, 'x'.repeat(201))
    ).rejects.toThrow(/at most 200 characters/i);
    expect(startSession).not.toHaveBeenCalled();
  });

  it('blocks live status, events, and knockout winners while a physical schedule is pending', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const findById = jest.spyOn(Match, 'findById');
    const pending = buildMatch({
      status: MatchStatus.SCHEDULED,
      stage: MatchStage.QUARTER_FINALS,
      fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
      scheduleStatus: MatchScheduleStatus.PENDING,
      date: undefined,
      venue: undefined,
    });

    findById.mockReturnValueOnce(queryResult(pending) as never);
    await expect(updateMatchStatus(pending._id.toString(), MatchStatus.LIVE)).rejects.toThrow(
      /confirm the physical kickoff time and venue/i
    );

    findById.mockReturnValueOnce(queryResult(pending) as never);
    await expect(
      addMatchEvent(
        pending._id.toString(),
        {
          type: MatchEventType.YELLOW_CARD,
          minute: 1,
          playerId: new Types.ObjectId(),
          teamId: pending.homeTeam,
        },
        'pending-event'
      )
    ).rejects.toThrow(/confirm the physical kickoff time and venue/i);

    findById.mockReturnValueOnce(queryResult(pending) as never);
    await expect(
      updateMatchWinner(pending._id.toString(), pending.homeTeam.toString(), false)
    ).rejects.toThrow(/confirm the physical kickoff time and venue/i);

    expect(mockedRecalculate).not.toHaveBeenCalled();
    expect(mockedBroadcastUpdate).not.toHaveBeenCalled();
  });

  it('fences the active venue version before confirming a physical schedule', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const existing = buildMatch({
      status: MatchStatus.SCHEDULED,
      scheduleStatus: MatchScheduleStatus.PENDING,
      date: undefined,
      venue: undefined,
      __v: 2,
    });
    jest.spyOn(Match, 'findById').mockReturnValue(queryResult(existing) as never);
    const venueId = new Types.ObjectId();
    jest.spyOn(Venue, 'find').mockReturnValue(
      queryResult([{ _id: venueId, name: 'Eclipse Arena', __v: 4 }]) as never
    );
    const venueFence = jest
      .spyOn(Venue, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never);
    jest.spyOn(Match, 'find').mockReturnValue(queryResult([]) as never);
    jest.spyOn(Tournament, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    const responseMatch = buildMatch({
      ...existing,
      date: new Date('2026-09-01T11:00:00.000Z'),
      venue: 'Eclipse Arena',
      scheduleStatus: MatchScheduleStatus.CONFIRMED,
      __v: 3,
    });
    jest
      .spyOn(Match, 'findOneAndUpdate')
      .mockReturnValue(queryResult(responseMatch) as never);

    await expect(
      updateMatchDetails(existing._id.toString(), {
        date: '2026-09-01T12:00:00+01:00',
        venue: 'eclipse arena',
      })
    ).resolves.toBe(responseMatch);
    expect(venueFence).toHaveBeenCalledWith(
      { _id: venueId, name: 'Eclipse Arena', isDeleted: false, __v: 4 },
      { $inc: { __v: 1 } },
      { session }
    );
    expect(mockedFenceTeamLifecycles).toHaveBeenCalledWith(
      [existing.homeTeam.toString(), existing.awayTeam.toString()],
      session
    );
    expect(mockedBroadcastUpdate).toHaveBeenCalledWith(
      existing._id.toString(),
      responseMatch
    );
  });

  it('rejects a cross-tournament same-team/day reschedule after acquiring team fences', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const sharedTeam = new Types.ObjectId();
    const existing = buildMatch({
      status: MatchStatus.SCHEDULED,
      homeTeam: sharedTeam,
      tournamentId: new Types.ObjectId(),
      scheduleStatus: MatchScheduleStatus.PENDING,
      date: undefined,
      venue: undefined,
    });
    const otherTournamentMatch = buildMatch({
      _id: new Types.ObjectId(),
      tournamentId: new Types.ObjectId(),
      homeTeam: sharedTeam,
      date: new Date('2026-09-01T14:00:00.000Z'),
      venue: 'Other Arena',
    });
    jest.spyOn(Match, 'findById').mockReturnValue(queryResult(existing) as never);
    jest.spyOn(Venue, 'find').mockReturnValue(
      queryResult([{ _id: new Types.ObjectId(), name: 'Eclipse Arena', __v: 0 }]) as never
    );
    jest.spyOn(Venue, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    const findMatches = jest
      .spyOn(Match, 'find')
      .mockReturnValue(queryResult([otherTournamentMatch]) as never);

    await expect(
      updateMatchDetails(existing._id.toString(), {
        date: '2026-09-01T15:00:00+01:00',
        venue: 'Eclipse Arena',
      })
    ).rejects.toThrow(/more than once on the same local calendar day/i);

    expect(mockedFenceTeamLifecycles).toHaveBeenCalledWith(
      [existing.homeTeam.toString(), existing.awayTeam.toString()],
      session
    );
    expect(findMatches).toHaveBeenCalledWith(
      expect.not.objectContaining({ tournamentId: expect.anything() })
    );
    expect(mockedRecalculate).not.toHaveBeenCalled();
  });

  it('locks completed women league event additions and deletions after qualification', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const findById = jest.spyOn(Match, 'findById');
    const goalId = new Types.ObjectId();
    const homeTeam = new Types.ObjectId();
    const lockedLeague = buildMatch({
      homeTeam,
      homeScore: 1,
      status: MatchStatus.COMPLETED,
      stage: MatchStage.LEAGUE,
      resultLockedAt: new Date('2026-09-15T12:00:00.000Z'),
      events: [
        {
          _id: goalId,
          type: MatchEventType.GOAL,
          minute: 10,
          playerId: new Types.ObjectId(),
          teamId: homeTeam,
        } as IMatchEvent,
      ],
    });

    findById.mockReturnValueOnce(queryResult(lockedLeague) as never);
    await expect(
      addMatchEvent(
        lockedLeague._id.toString(),
        {
          type: MatchEventType.YELLOW_CARD,
          minute: 40,
          playerId: new Types.ObjectId(),
          teamId: homeTeam,
        },
        'locked-women-add'
      )
    ).rejects.toThrow(/locked after qualification/i);

    findById.mockReturnValueOnce(queryResult(lockedLeague) as never);
    await expect(
      deleteMatchEvent(lockedLeague._id.toString(), goalId.toString())
    ).rejects.toThrow(/locked after qualification/i);
    expect(lockedLeague.save).not.toHaveBeenCalled();
    expect(mockedRecalculate).not.toHaveBeenCalled();
    expect(mockedBroadcastUpdate).not.toHaveBeenCalled();
  });

  it('allows a completed women league correction before qualification is finalized', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const findById = jest.spyOn(Match, 'findById');
    const homeTeam = new Types.ObjectId();
    const playerId = new Types.ObjectId();
    const editableLeague = buildMatch({
      homeTeam,
      status: MatchStatus.COMPLETED,
      stage: MatchStage.LEAGUE,
    });
    const responseMatch = { ...editableLeague };
    findById
      .mockReturnValueOnce(queryResult(editableLeague) as never)
      .mockReturnValueOnce(queryResult(responseMatch) as never);
    jest.spyOn(Tournament, 'findById').mockReturnValue(
      queryResult({
        formatVersion: 3,
        format: TournamentFormat.SINGLE_TABLE_FINAL,
        workflowState: CompetitionWorkflowState.GROUP_STAGE,
      }) as never
    );
    jest
      .spyOn(TournamentRosterEntry, 'find')
      .mockReturnValue(queryResult([playerId]) as never);

    await expect(
      addMatchEvent(
        editableLeague._id.toString(),
        {
          type: MatchEventType.YELLOW_CARD,
          minute: 40,
          playerId,
          teamId: homeTeam,
        },
        'editable-women-add'
      )
    ).resolves.toEqual(expect.objectContaining({ replayed: false }));
    expect(editableLeague.save).toHaveBeenCalledWith({ session });
    expect(mockedRecalculate).toHaveBeenCalledTimes(1);
  });

  it('propagates a rebuild failure without broadcasting, then applies one event on retry', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const findById = jest.spyOn(Match, 'findById');
    const tournament = jest.spyOn(Tournament, 'findById');
    const player = jest.spyOn(Player, 'findOne');
    const homeTeam = new Types.ObjectId();
    const playerId = new Types.ObjectId();
    const firstAttempt = buildMatch({ homeTeam });

    findById.mockReturnValueOnce(queryResult(firstAttempt) as never);
    tournament.mockReturnValueOnce(
      queryResult({ formatVersion: 1, format: TournamentFormat.LEGACY_LEAGUE }) as never
    );
    player.mockReturnValueOnce(queryResult({ _id: playerId }) as never);
    mockedRecalculate.mockRejectedValueOnce(new Error('derived rebuild unavailable'));

    const event = {
      type: MatchEventType.YELLOW_CARD,
      minute: 12,
      playerId,
      teamId: homeTeam,
    };
    await expect(addMatchEvent(firstAttempt._id.toString(), event, 'attempt-1')).rejects.toThrow(
      'derived rebuild unavailable'
    );

    expect(firstAttempt.save).toHaveBeenCalledWith({ session });
    expect(mockedRecalculate).toHaveBeenCalledWith(
      firstAttempt.tournamentId.toString(),
      session
    );
    expect(mockedBroadcastGoal).not.toHaveBeenCalled();
    expect(mockedBroadcastUpdate).not.toHaveBeenCalled();

    // A transaction abort leaves the durable match unchanged. Model that
    // fresh database read on retry instead of reusing the mutated test object.
    const retryAttempt = buildMatch({
      _id: firstAttempt._id,
      tournamentId: firstAttempt.tournamentId,
      homeTeam,
    });
    const responseMatch = { ...retryAttempt, events: [] };
    findById
      .mockReturnValueOnce(queryResult(retryAttempt) as never)
      .mockReturnValueOnce(queryResult(responseMatch) as never);
    tournament.mockReturnValueOnce(
      queryResult({ formatVersion: 1, format: TournamentFormat.LEGACY_LEAGUE }) as never
    );
    player.mockReturnValueOnce(queryResult({ _id: playerId }) as never);
    mockedRecalculate.mockResolvedValueOnce(undefined);

    const retryResult = await addMatchEvent(retryAttempt._id.toString(), event, 'attempt-1');

    expect(retryAttempt.events).toHaveLength(1);
    expect(retryResult).toEqual({
      match: responseMatch,
      eventId: retryAttempt.events[0]._id?.toString(),
      replayed: false,
    });
    expect(retryAttempt.events[0].operationKey).toBe(
      createHash('sha256').update('attempt-1').digest('hex')
    );
    expect(mockedBroadcastUpdate).toHaveBeenCalledTimes(1);
  });

  it('replays the same event key without another write and rejects key reuse for another payload', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const findById = jest.spyOn(Match, 'findById');
    const operationKey = createHash('sha256').update('stable-key').digest('hex');
    const homeTeam = new Types.ObjectId();
    const playerId = new Types.ObjectId();
    const storedEvent = {
      _id: new Types.ObjectId(),
      type: MatchEventType.YELLOW_CARD,
      minute: 25,
      playerId,
      teamId: homeTeam,
      operationKey,
    } as IMatchEvent;
    const persisted = buildMatch({ homeTeam, events: [storedEvent] });
    const responseMatch = { ...persisted };
    findById
      .mockReturnValueOnce(queryResult(persisted) as never)
      .mockReturnValueOnce(queryResult(responseMatch) as never);

    await expect(
      addMatchEvent(
        persisted._id.toString(),
        {
          type: MatchEventType.YELLOW_CARD,
          minute: 25,
          playerId,
          teamId: homeTeam,
        },
        'stable-key'
      )
    ).resolves.toEqual({
      match: responseMatch,
      eventId: storedEvent._id?.toString(),
      replayed: true,
    });

    expect(persisted.save).not.toHaveBeenCalled();
    expect(mockedRecalculate).not.toHaveBeenCalled();
    expect(mockedBroadcastUpdate).not.toHaveBeenCalled();

    const conflictingRead = buildMatch({ homeTeam, events: [storedEvent] });
    findById.mockReturnValueOnce(queryResult(conflictingRead) as never);
    await expect(
      addMatchEvent(
        conflictingRead._id.toString(),
        {
          type: MatchEventType.YELLOW_CARD,
          minute: 26,
          playerId,
          teamId: homeTeam,
        },
        'stable-key'
      )
    ).rejects.toThrow(/already used for a different match event/i);
  });

  it('uses a durable deletion tombstone for retry success but rejects a never-existing event', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const findById = jest.spyOn(Match, 'findById');
    const eventId = new Types.ObjectId();
    const event = {
      _id: eventId,
      type: MatchEventType.YELLOW_CARD,
      minute: 30,
      playerId: new Types.ObjectId(),
      teamId: new Types.ObjectId(),
    } as IMatchEvent;
    const firstRead = buildMatch({ events: [event] });
    const firstResponse = { ...firstRead, events: [] };
    findById
      .mockReturnValueOnce(queryResult(firstRead) as never)
      .mockReturnValueOnce(queryResult(firstResponse) as never);

    await expect(
      deleteMatchEvent(firstRead._id.toString(), eventId.toString())
    ).resolves.toBe(firstResponse);
    expect(firstRead.deletedEventIds).toEqual([eventId]);
    expect(firstRead.save).toHaveBeenCalledWith({ session });
    expect(mockedBroadcastUpdate).toHaveBeenCalledTimes(1);

    const retryRead = buildMatch({
      _id: firstRead._id,
      tournamentId: firstRead.tournamentId,
      events: [],
      deletedEventIds: [eventId],
    });
    const retryResponse = { ...retryRead };
    findById
      .mockReturnValueOnce(queryResult(retryRead) as never)
      .mockReturnValueOnce(queryResult(retryResponse) as never);
    await expect(
      deleteMatchEvent(retryRead._id.toString(), eventId.toString())
    ).resolves.toBe(retryResponse);
    expect(retryRead.save).not.toHaveBeenCalled();
    expect(mockedRecalculate).toHaveBeenCalledTimes(1);
    expect(mockedBroadcastUpdate).toHaveBeenCalledTimes(1);

    const unknownRead = buildMatch({ events: [], deletedEventIds: [] });
    findById.mockReturnValueOnce(queryResult(unknownRead) as never);
    await expect(
      deleteMatchEvent(unknownRead._id.toString(), new Types.ObjectId().toString())
    ).rejects.toThrow('Match event not found');
  });

  it('rebuilds derived state on an idempotent same-status retry', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const responseMatch = { _id: new Types.ObjectId() };
    const existing = buildMatch({
      status: MatchStatus.LIVE,
      populate: jest.fn().mockResolvedValue(responseMatch),
    });
    jest.spyOn(Match, 'findById').mockReturnValue(queryResult(existing) as never);
    const tournamentUpdate = jest
      .spyOn(Tournament, 'updateOne')
      .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);
    const update = jest.spyOn(Match, 'findOneAndUpdate');

    await expect(updateMatchStatus(existing._id.toString(), MatchStatus.LIVE)).resolves.toBe(
      responseMatch
    );

    expect(mockedRecalculate).toHaveBeenCalledWith(
      existing.tournamentId.toString(),
      session
    );
    expect(update).not.toHaveBeenCalled();
    expect(tournamentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: existing.tournamentId,
        status: 'upcoming',
      }),
      { $set: { status: 'ongoing' } },
      { session }
    );
    expect(mockedBroadcastUpdate).not.toHaveBeenCalled();
  });

  it.each([
    [2, TournamentFormat.TWO_GROUP_KNOCKOUT],
    [3, TournamentFormat.SINGLE_TABLE_FINAL],
  ])(
    'atomically marks a managed v%s tournament ongoing on its first live match',
    async (formatVersion, format) => {
      const session = buildSession();
      jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
      const scheduled = buildMatch({ status: MatchStatus.SCHEDULED, __v: 0 });
      const live = buildMatch({ ...scheduled, status: MatchStatus.LIVE, __v: 1 });
      jest.spyOn(Match, 'findById').mockReturnValue(queryResult(scheduled) as never);
      jest.spyOn(Match, 'findOneAndUpdate').mockReturnValue(queryResult(live) as never);
      const tournamentUpdate = jest
        .spyOn(Tournament, 'updateOne')
        .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);

      await expect(
        updateMatchStatus(scheduled._id.toString(), MatchStatus.LIVE)
      ).resolves.toBe(live);

      expect(tournamentUpdate).toHaveBeenCalledWith(
        {
          _id: scheduled.tournamentId,
          status: 'upcoming',
          isDeleted: false,
          $or: [
            { formatVersion: 2, format: TournamentFormat.TWO_GROUP_KNOCKOUT },
            { formatVersion: 3, format: TournamentFormat.SINGLE_TABLE_FINAL },
          ],
        },
        { $set: { status: 'ongoing' } },
        { session }
      );
      expect(formatVersion).toBe(format === TournamentFormat.TWO_GROUP_KNOCKOUT ? 2 : 3);
    }
  );

  it('applies result locks consistently to status, schedule, and winner mutations', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const findById = jest.spyOn(Match, 'findById');
    const locked = buildMatch({
      status: MatchStatus.COMPLETED,
      stage: MatchStage.FINAL,
      winner: new Types.ObjectId(),
      resultLockedAt: new Date('2026-09-20T18:00:00.000Z'),
    });

    findById.mockReturnValueOnce(queryResult(locked) as never);
    await expect(updateMatchStatus(locked._id.toString(), MatchStatus.LIVE)).rejects.toThrow(
      /locked/i
    );
    findById.mockReturnValueOnce(queryResult(locked) as never);
    await expect(
      updateMatchDetails(locked._id.toString(), { date: null, venue: null })
    ).rejects.toThrow(/locked/i);
    findById.mockReturnValueOnce(queryResult(locked) as never);
    await expect(
      updateMatchWinner(locked._id.toString(), locked.homeTeam.toString(), false)
    ).rejects.toThrow(/locked/i);

    expect(mockedRecalculate).not.toHaveBeenCalled();
    expect(mockedBroadcastUpdate).not.toHaveBeenCalled();
  });

  it('reopens an editable v2 quarter-final for a score and penalty-winner correction', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const findById = jest.spyOn(Match, 'findById');
    const findOneAndUpdate = jest.spyOn(Match, 'findOneAndUpdate');
    jest
      .spyOn(Tournament, 'updateOne')
      .mockResolvedValue({ matchedCount: 1, modifiedCount: 0 } as never);
    const bracketId = new Types.ObjectId();
    const matchId = new Types.ObjectId();
    const tournamentId = new Types.ObjectId();
    const homeTeam = new Types.ObjectId();
    const awayTeam = new Types.ObjectId();
    const goalId = new Types.ObjectId();
    const goal = {
      _id: goalId,
      type: MatchEventType.GOAL,
      minute: 44,
      playerId: new Types.ObjectId(),
      teamId: homeTeam,
    } as IMatchEvent;
    const completedQuarterFinal = buildMatch({
      _id: matchId,
      tournamentId,
      homeTeam,
      awayTeam,
      homeScore: 1,
      awayScore: 0,
      status: MatchStatus.COMPLETED,
      stage: MatchStage.QUARTER_FINALS,
      bracketId,
      bracketNodeKey: 'qf-1',
      winner: homeTeam,
      events: [goal],
      __v: 3,
    });
    const reopened = buildMatch({
      ...completedQuarterFinal,
      status: MatchStatus.LIVE,
      winner: undefined,
      isExtraTime: false,
      shootoutScore: undefined,
      events: [goal],
      __v: 4,
    });
    jest.spyOn(CompetitionBracket, 'findById').mockReturnValue(
      queryResult({
        nodes: [
          {
            key: 'qf-1',
            stage: MatchStage.QUARTER_FINALS,
            slot: 1,
            kind: CompetitionBracketNodeKind.CHAMPIONSHIP,
            homeSource: {
              type: CompetitionBracketSourceType.DRAW_PAIRING,
              drawPairingSlot: 1,
              drawSide: 'home',
            },
            awaySource: {
              type: CompetitionBracketSourceType.DRAW_PAIRING,
              drawPairingSlot: 1,
              drawSide: 'away',
            },
          },
        ],
      }) as never
    );
    findById.mockReturnValueOnce(queryResult(completedQuarterFinal) as never);
    findOneAndUpdate.mockReturnValueOnce(queryResult(reopened) as never);

    await expect(updateMatchStatus(matchId.toString(), MatchStatus.LIVE)).resolves.toBe(
      reopened
    );
    expect(findOneAndUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        _id: matchId.toString(),
        status: MatchStatus.COMPLETED,
        __v: 3,
      }),
      {
        $set: { status: MatchStatus.LIVE, isExtraTime: false },
        $unset: { winner: 1, shootoutScore: 1 },
        $inc: { __v: 1 },
      },
      expect.objectContaining({ session })
    );

    const correctionState = buildMatch({
      ...reopened,
      events: [goal],
      deletedEventIds: [],
      save: jest.fn().mockResolvedValue(undefined),
    });
    const correctedScoreResponse = { ...correctionState, events: [], homeScore: 0 };
    findById.mockReset();
    findById
      .mockReturnValueOnce(queryResult(correctionState) as never)
      .mockReturnValueOnce(queryResult(correctedScoreResponse) as never);

    await deleteMatchEvent(matchId.toString(), goalId.toString());
    expect(correctionState.homeScore).toBe(0);
    expect(correctionState.events).toHaveLength(0);

    const tiedLiveMatch = buildMatch({
      ...correctionState,
      homeScore: 0,
      awayScore: 0,
      status: MatchStatus.LIVE,
      events: [],
      __v: 5,
    });
    const resolvedAwayOnPens = {
      ...tiedLiveMatch,
      status: MatchStatus.COMPLETED,
      winner: awayTeam,
      shootoutScore: { home: 4, away: 5 },
    };
    findById.mockReset().mockReturnValueOnce(queryResult(tiedLiveMatch) as never);
    findOneAndUpdate.mockReset().mockReturnValueOnce(queryResult(resolvedAwayOnPens) as never);

    await expect(
      updateMatchWinner(matchId.toString(), awayTeam.toString(), false, {
        home: 4,
        away: 5,
      })
    ).resolves.toBe(resolvedAwayOnPens);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: matchId.toString(),
        homeScore: 0,
        awayScore: 0,
        resultLockedAt: { $exists: false },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          winner: awayTeam.toString(),
          status: MatchStatus.COMPLETED,
          shootoutScore: { home: 4, away: 5 },
        }),
      }),
      expect.objectContaining({ session })
    );
    expect(mockedRecalculate).toHaveBeenCalledTimes(3);
    expect(mockedBroadcastUpdate).toHaveBeenCalledTimes(3);
  });
});
