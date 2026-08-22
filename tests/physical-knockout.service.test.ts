import { createHash } from 'crypto';
import mongoose, { Types } from 'mongoose';
import CompetitionBracket, {
  CompetitionBracketNodeKind,
  CompetitionBracketSourceType,
  CompetitionBracketStatus,
} from '@/models/competition-bracket.model';
import CompetitionDraw, {
  CompetitionDrawStatus,
  CompetitionDrawType,
} from '@/models/competition-draw.model';
import CompetitionOperation, {
  CompetitionOperationStatus,
} from '@/models/competition-operation.model';
import Match, {
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import Tournament, {
  CompetitionDrawMode,
  CompetitionWorkflowState,
  FIXED_V2_COMPETITION_RULES,
  TournamentFormat,
} from '@/models/tournament.model';
import Venue from '@/models/venue.model';
import {
  CompetitionError,
  createKnockoutDraw,
  progressKnockout,
  publishKnockoutDraw,
} from '@/services/competition.service';
import { buildKnockoutBracketPlan } from '@/utils/competition.util';

const queryResult = <T>(value: T) => {
  const promise = Promise.resolve(value);
  const query = {
    select: jest.fn(),
    sort: jest.fn(),
    session: jest.fn(),
    lean: jest.fn().mockResolvedValue(value),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.session.mockReturnValue(query);
  return query;
};

const buildSession = () => ({
  withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()),
  endSession: jest.fn().mockResolvedValue(undefined),
});

const tournamentId = new Types.ObjectId();
const adminId = new Types.ObjectId().toString();
const qualificationSnapshot = Array.from({ length: 8 }, (_, index) => ({
  tournamentEntryId: new Types.ObjectId(),
  teamId: new Types.ObjectId(),
  groupKey: index < 4 ? ('A' as const) : ('B' as const),
  rank: (index % 4) + 1,
  points: 10 - index,
  goalDifference: 5 - index,
  goalsFor: 12 - index,
}));

const pendingPairings = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
].map(([home, away], index) => ({
  slot: index + 1,
  homeEntryId: qualificationSnapshot[home].tournamentEntryId.toString(),
  awayEntryId: qualificationSnapshot[away].tournamentEntryId.toString(),
  kickoffAt: null,
  venue: null,
}));

const mockEmptyReceipt = () =>
  jest.spyOn(CompetitionOperation, 'findOne').mockReturnValue(queryResult(null) as never);

const mockTransactionReceiptWrites = () => {
  jest.spyOn(CompetitionOperation, 'create').mockResolvedValue([] as never);
  jest.spyOn(CompetitionOperation, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
};

const qualificationTournament = (workflowRevision = 9) => ({
  _id: tournamentId,
  formatVersion: 2,
  format: TournamentFormat.TWO_GROUP_KNOCKOUT,
  workflowRevision,
  workflowState: CompetitionWorkflowState.QUALIFICATION_FINALIZED,
  competitionRules: { ...FIXED_V2_COMPETITION_RULES },
  qualificationSnapshot,
});

describe('physical knockout service contract', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records arbitrary physical quarter-final pairings without inventing seeded pairings', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    mockEmptyReceipt();
    mockTransactionReceiptWrites();
    jest
      .spyOn(Tournament, 'findOne')
      .mockReturnValue(queryResult(qualificationTournament()) as never);
    jest.spyOn(Venue, 'find').mockReturnValue(queryResult([]) as never);
    jest.spyOn(Match, 'find').mockReturnValue(queryResult([]) as never);
    jest.spyOn(CompetitionDraw, 'findOne').mockReturnValue(queryResult(null) as never);
    jest.spyOn(CompetitionDraw, 'updateMany').mockResolvedValue({ modifiedCount: 0 } as never);
    const create = jest
      .spyOn(CompetitionDraw, 'create')
      .mockResolvedValue([{ _id: new Types.ObjectId() }] as never);
    jest.spyOn(Tournament, 'findOneAndUpdate').mockResolvedValue({ workflowRevision: 10 } as never);

    const result = await createKnockoutDraw(
      tournamentId.toString(),
      {
        expectedRevision: 9,
        sourceReference: 'physical-draw-sheet-1',
        pairings: pendingPairings,
      },
      adminId,
      'manual-qf-draft-1'
    );

    expect(result.replayed).toBe(false);
    expect(result.data.workflowRevision).toBe(10);
    expect(create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: CompetitionDrawType.KNOCKOUT,
          stage: MatchStage.QUARTER_FINALS,
          status: CompetitionDrawStatus.DRAFT,
          mode: CompetitionDrawMode.MANUAL,
          sourceReference: 'physical-draw-sheet-1',
          planHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          pairings: pendingPairings.map((pairing, index) =>
            expect.objectContaining({
              slot: pairing.slot,
              homeEntryId: qualificationSnapshot[index * 2].tournamentEntryId,
              awayEntryId: qualificationSnapshot[index * 2 + 1].tournamentEntryId,
              homeTeamId: qualificationSnapshot[index * 2].teamId,
              awayTeamId: qualificationSnapshot[index * 2 + 1].teamId,
              scheduleStatus: MatchScheduleStatus.PENDING,
            })
          ),
        }),
      ],
      { session }
    );
  });

  it('rejects qualifier reuse and schedules that collide with an existing tournament match', async () => {
    const duplicateSession = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(duplicateSession as never);
    mockEmptyReceipt();
    mockTransactionReceiptWrites();
    jest
      .spyOn(Tournament, 'findOne')
      .mockReturnValue(queryResult(qualificationTournament()) as never);
    jest.spyOn(Venue, 'find').mockReturnValue(queryResult([]) as never);
    jest.spyOn(Match, 'find').mockReturnValue(queryResult([]) as never);

    const duplicated = pendingPairings.map((pairing) => ({ ...pairing }));
    duplicated[1].homeEntryId = duplicated[0].homeEntryId;
    await expect(
      createKnockoutDraw(
        tournamentId.toString(),
        { expectedRevision: 9, pairings: duplicated },
        adminId,
        'manual-qf-duplicate'
      )
    ).rejects.toMatchObject<Partial<CompetitionError>>({
      code: 'PHYSICAL_DRAW_ENTRY_DUPLICATED',
      statusCode: 422,
    });

    jest.restoreAllMocks();
    const collisionSession = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(collisionSession as never);
    mockEmptyReceipt();
    mockTransactionReceiptWrites();
    jest
      .spyOn(Tournament, 'findOne')
      .mockReturnValue(queryResult(qualificationTournament()) as never);
    jest
      .spyOn(Venue, 'find')
      .mockReturnValue(
        queryResult([{ _id: new Types.ObjectId(), name: 'Solid FM Arena', __v: 0 }]) as never
      );
    const venueFence = jest
      .spyOn(Venue, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never);
    const kickoff = new Date('2026-09-01T11:00:00.000Z');
    jest.spyOn(Match, 'find').mockReturnValue(
      queryResult([
        {
          homeTeam: new Types.ObjectId(),
          awayTeam: new Types.ObjectId(),
          date: kickoff,
          venue: 'Solid FM Arena',
        },
      ]) as never
    );
    const scheduledPairings = pendingPairings.map((pairing, index) =>
      index === 0
        ? {
            ...pairing,
            kickoffAt: kickoff.toISOString(),
            venue: 'solid fm arena',
          }
        : pairing
    );
    await expect(
      createKnockoutDraw(
        tournamentId.toString(),
        { expectedRevision: 9, pairings: scheduledPairings },
        adminId,
        'manual-qf-collision'
      )
    ).rejects.toMatchObject<Partial<CompetitionError>>({
      code: 'PHYSICAL_DRAW_EXISTING_VENUE_COLLISION',
      statusCode: 422,
    });
    expect(venueFence).toHaveBeenCalledTimes(1);
  });

  it('replays an already-published physical draw safely and rejects changed-key reuse', async () => {
    const drawId = new Types.ObjectId().toString();
    const expectedRevision = 14;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ drawId, expectedRevision }))
      .digest('hex');
    const publishedResult = {
      drawId,
      bracketId: new Types.ObjectId().toString(),
      fixtureCount: 4,
      confirmedCount: 0,
      pendingCount: 4,
      workflowRevision: 15,
    };
    const findReceipt = jest.spyOn(CompetitionOperation, 'findOne');
    findReceipt.mockReturnValueOnce(
      queryResult({
        requestHash,
        status: CompetitionOperationStatus.COMPLETED,
        result: publishedResult,
      }) as never
    );
    const startSession = jest.spyOn(mongoose, 'startSession');

    await expect(
      publishKnockoutDraw(
        tournamentId.toString(),
        drawId,
        expectedRevision,
        adminId,
        'publish-physical-qf-1'
      )
    ).resolves.toEqual({ data: publishedResult, replayed: true });
    expect(startSession).not.toHaveBeenCalled();

    findReceipt.mockReturnValueOnce(
      queryResult({
        requestHash,
        status: CompetitionOperationStatus.COMPLETED,
        result: publishedResult,
      }) as never
    );
    await expect(
      publishKnockoutDraw(
        tournamentId.toString(),
        drawId,
        expectedRevision + 1,
        adminId,
        'publish-physical-qf-1'
      )
    ).rejects.toMatchObject<Partial<CompetitionError>>({
      code: 'IDEMPOTENCY_KEY_REUSED',
      statusCode: 409,
    });
  });

  it('fences each confirmed venue before publishing the recorded quarter-finals', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    mockEmptyReceipt();
    mockTransactionReceiptWrites();
    const expectedRevision = 14;
    jest
      .spyOn(Tournament, 'findOne')
      .mockReturnValue(queryResult(qualificationTournament(expectedRevision)) as never);

    const drawId = new Types.ObjectId();
    const sourceReference = 'physical-draw-sheet-1';
    const drawPairings = pendingPairings.map((pairing, index) => ({
      slot: pairing.slot,
      homeEntryId: qualificationSnapshot[index * 2].tournamentEntryId,
      awayEntryId: qualificationSnapshot[index * 2 + 1].tournamentEntryId,
      homeTeamId: qualificationSnapshot[index * 2].teamId,
      awayTeamId: qualificationSnapshot[index * 2 + 1].teamId,
      kickoffAt: new Date(Date.UTC(2026, 9, index + 1, 11)),
      venue: 'Solid FM Arena',
      scheduleStatus: MatchScheduleStatus.CONFIRMED,
    }));
    const planHash = createHash('sha256')
      .update(
        JSON.stringify({
          tournamentId: tournamentId.toString(),
          stage: MatchStage.QUARTER_FINALS,
          sourceReference,
          pairings: drawPairings.map((pairing) => ({
            slot: pairing.slot,
            homeEntryId: pairing.homeEntryId.toString(),
            awayEntryId: pairing.awayEntryId.toString(),
            homeTeamId: pairing.homeTeamId.toString(),
            awayTeamId: pairing.awayTeamId.toString(),
            kickoffAt: pairing.kickoffAt.toISOString(),
            venue: pairing.venue,
            scheduleStatus: pairing.scheduleStatus,
          })),
        })
      )
      .digest('hex');
    const draw = {
      _id: drawId,
      tournamentId,
      type: CompetitionDrawType.KNOCKOUT,
      stage: MatchStage.QUARTER_FINALS,
      version: 1,
      status: CompetitionDrawStatus.DRAFT,
      mode: CompetitionDrawMode.MANUAL,
      inputSnapshot: qualificationSnapshot.map((entry) => ({
        tournamentEntryId: entry.tournamentEntryId,
        teamId: entry.teamId,
        groupKey: entry.groupKey,
        groupRank: entry.rank,
      })),
      pairings: drawPairings,
      planHash,
      sourceReference,
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(CompetitionDraw, 'findOne').mockReturnValue(queryResult(draw) as never);
    const venueDocument = {
      _id: new Types.ObjectId(),
      name: 'Solid FM Arena',
      __v: 6,
    };
    jest
      .spyOn(Venue, 'find')
      .mockReturnValue(queryResult([venueDocument]) as never);
    const venueFence = jest
      .spyOn(Venue, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never);
    jest.spyOn(Match, 'find').mockReturnValue(queryResult([]) as never);
    jest
      .spyOn(CompetitionBracket.prototype, 'save')
      .mockResolvedValue(undefined as never);
    const insertMany = jest.spyOn(Match, 'insertMany');
    insertMany.mockImplementation(
      (async (documents: Array<Record<string, unknown>>) =>
        documents.map((document) => ({
          ...document,
          _id: new Types.ObjectId(),
        }))) as never
    );
    jest
      .spyOn(Tournament, 'findOneAndUpdate')
      .mockResolvedValue({ workflowRevision: expectedRevision + 1 } as never);

    const result = await publishKnockoutDraw(
      tournamentId.toString(),
      drawId.toString(),
      expectedRevision,
      adminId,
      'publish-recorded-qf-with-venue-fence'
    );

    expect(result.replayed).toBe(false);
    expect(result.data).toEqual(
      expect.objectContaining({
        fixtureCount: 4,
        confirmedCount: 4,
        pendingCount: 0,
        workflowRevision: expectedRevision + 1,
      })
    );
    expect(venueFence).toHaveBeenCalledTimes(1);
    expect(venueFence).toHaveBeenCalledWith(
      {
        _id: venueDocument._id,
        name: venueDocument.name,
        isDeleted: false,
        __v: 6,
      },
      { $inc: { __v: 1 } },
      { session }
    );
    expect(insertMany.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          venue: 'Solid FM Arena',
          scheduleStatus: MatchScheduleStatus.CONFIRMED,
        }),
      ])
    );
  });

  it('follows published bracket adjacency and creates only pending unscheduled semi-finals', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    mockEmptyReceipt();
    mockTransactionReceiptWrites();
    const workflowRevision = 20;
    jest.spyOn(Tournament, 'findOne').mockReturnValue(
      queryResult({
        ...qualificationTournament(workflowRevision),
        workflowState: CompetitionWorkflowState.KNOCKOUT_STAGE,
        currentStage: MatchStage.QUARTER_FINALS,
      }) as never
    );

    const bracketId = new Types.ObjectId();
    const qfTeams = Array.from({ length: 8 }, () => new Types.ObjectId());
    const qfMatchIds = Array.from({ length: 4 }, () => new Types.ObjectId());
    const bracket = {
      _id: bracketId,
      sourceDrawId: new Types.ObjectId(),
      entrantCount: 8,
      status: CompetitionBracketStatus.ACTIVE,
      revision: workflowRevision,
      nodes: buildKnockoutBracketPlan(8, false).map((node) => {
        const isQuarterFinal = node.stage === MatchStage.QUARTER_FINALS;
        const index = node.slot - 1;
        return {
          ...node,
          stage: node.stage as MatchStage,
          kind: node.kind as CompetitionBracketNodeKind,
          homeSource: {
            ...node.homeSource,
            type: node.homeSource.type as CompetitionBracketSourceType,
          },
          awaySource: {
            ...node.awaySource,
            type: node.awaySource.type as CompetitionBracketSourceType,
          },
          ...(isQuarterFinal
            ? {
                homeTeamId: qfTeams[index * 2],
                awayTeamId: qfTeams[index * 2 + 1],
                matchId: qfMatchIds[index],
              }
            : {}),
        };
      }),
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(CompetitionBracket, 'findOne').mockReturnValue(queryResult(bracket) as never);
    jest.spyOn(CompetitionDraw, 'findOne').mockReturnValue(
      queryResult({
        _id: bracket.sourceDrawId,
        tournamentId,
        type: CompetitionDrawType.KNOCKOUT,
        stage: MatchStage.QUARTER_FINALS,
        status: CompetitionDrawStatus.PUBLISHED,
        mode: CompetitionDrawMode.MANUAL,
      }) as never
    );

    const completedQuarterFinals = qfMatchIds.map((matchId, index) => ({
      _id: matchId,
      bracketId,
      bracketNodeKey: `quarter_finals:${index + 1}`,
      stage: MatchStage.QUARTER_FINALS,
      scheduleStatus: MatchScheduleStatus.CONFIRMED,
      date: new Date(Date.UTC(2026, 8, index + 1, 11)),
      venue: 'Solid FM Arena',
      status: MatchStatus.COMPLETED,
      homeTeam: qfTeams[index * 2],
      awayTeam: qfTeams[index * 2 + 1],
      homeScore: 1,
      awayScore: 0,
      winner: qfTeams[index * 2],
      shootoutScore: undefined,
    }));
    jest.spyOn(Match, 'find').mockReturnValue(queryResult(completedQuarterFinals) as never);
    jest.spyOn(Match, 'updateMany').mockResolvedValue({ modifiedCount: 4 } as never);
    const insertMany = jest.spyOn(Match, 'insertMany');
    insertMany.mockImplementation(
      (async (documents: Array<Record<string, unknown>>) =>
        documents.map((document) => ({
          ...document,
          _id: new Types.ObjectId(),
        }))) as never
    );
    jest
      .spyOn(Tournament, 'findOneAndUpdate')
      .mockResolvedValue({ workflowRevision: workflowRevision + 1 } as never);

    const result = await progressKnockout(
      tournamentId.toString(),
      workflowRevision,
      adminId,
      'advance-to-physical-semis'
    );

    expect(result.replayed).toBe(false);
    expect(result.data).toEqual(
      expect.objectContaining({
        action: 'round_advanced',
        stage: MatchStage.SEMI_FINALS,
        fixtureCount: 2,
        confirmedCount: 0,
        pendingCount: 2,
        fixtures: [
          expect.objectContaining({
            homeTeamId: qfTeams[0].toString(),
            awayTeamId: qfTeams[2].toString(),
            kickoffAt: null,
            venue: null,
            scheduleStatus: MatchScheduleStatus.PENDING,
          }),
          expect.objectContaining({
            homeTeamId: qfTeams[4].toString(),
            awayTeamId: qfTeams[6].toString(),
            kickoffAt: null,
            venue: null,
            scheduleStatus: MatchScheduleStatus.PENDING,
          }),
        ],
      })
    );
    const publishedRows = insertMany.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(publishedRows).toHaveLength(2);
    expect(publishedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: MatchStage.SEMI_FINALS,
          scheduleStatus: MatchScheduleStatus.PENDING,
          officialFixtureNumber: 47,
        }),
        expect.objectContaining({
          stage: MatchStage.SEMI_FINALS,
          scheduleStatus: MatchScheduleStatus.PENDING,
          officialFixtureNumber: 48,
        }),
      ])
    );
    expect(publishedRows.every((row) => !('date' in row) && !('venue' in row))).toBe(true);
    expect(bracket.save).toHaveBeenCalledWith({ session });
  });
});
