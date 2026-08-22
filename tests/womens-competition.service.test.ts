jest.mock('@/services/team-lifecycle.service', () => ({
  fenceTeamLifecycle: jest.fn(),
  fenceTeamLifecycles: jest.fn(),
}));

import { createHash } from 'crypto';
import mongoose, { Types } from 'mongoose';
import CompetitionBracket from '@/models/competition-bracket.model';
import CompetitionDraw from '@/models/competition-draw.model';
import CompetitionOperation, {
  CompetitionOperationStatus,
} from '@/models/competition-operation.model';
import Match, {
  MatchFixtureSource,
  MatchScheduleStatus,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import Player from '@/models/player.model';
import PlayerStats from '@/models/player-stats.model';
import Standings from '@/models/standings.model';
import Team from '@/models/team.model';
import Tournament, {
  CompetitionCommitteeDecisionMethod,
  CompetitionWorkflowState,
  FIXED_WOMENS_COMPETITION_RULES,
  TournamentFormat,
} from '@/models/tournament.model';
import TournamentEntry, {
  TournamentEntrySource,
  TournamentEntryStatus,
} from '@/models/tournament-entry.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import Venue from '@/models/venue.model';
import WomensCompetitionFinal, {
  WomensFinalStatus,
} from '@/models/womens-competition-final.model';
import { CompetitionDivision } from '@/models/competition-division';
import {
  addWomensEntry,
  finalizeWomensQualification,
  getWomensRankingState,
  getPublishedWomensLeaguePlan,
  getWomensFinalPlan,
  listWomensEntries,
  previewWomensFinal,
  previewWomensLeagueFixtures,
  progressWomensFinal,
  publishWomensFinal,
  publishWomensLeagueFixtures,
  resolveWomensTableTie,
} from '@/services/womens-competition.service';
import { CompetitionError } from '@/services/competition.service';
import {
  fenceTeamLifecycle,
  fenceTeamLifecycles,
} from '@/services/team-lifecycle.service';

const queryResult = <T>(value: T) => {
  const promise = Promise.resolve(value);
  const query = {
    select: jest.fn(),
    sort: jest.fn(),
    session: jest.fn(),
    populate: jest.fn(),
    lean: jest.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.session.mockReturnValue(query);
  query.populate.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  return query;
};

const sequentialSessionResult = <T>(
  label: string,
  value: T,
  state: { active: boolean; order: string[] }
) => ({
  session: jest.fn(() => {
    if (state.active) throw new Error(`parallel transaction query: ${label}`);
    state.active = true;
    return Promise.resolve().then(() => {
      state.active = false;
      state.order.push(label);
      return value;
    });
  }),
});

const buildSession = () => ({
  withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()),
  endSession: jest.fn().mockResolvedValue(undefined),
});

const tournamentId = new Types.ObjectId();
const adminId = new Types.ObjectId().toString();
const entryIds = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
const teamIds = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
const entries = entryIds.map((id, index) => ({
  _id: id,
  tournamentId,
  teamId: teamIds[index],
  status: TournamentEntryStatus.ACTIVE,
  source: TournamentEntrySource.ADMIN,
  groupKey: 'A' as const,
  groupSlot: index + 1,
  teamNameSnapshot: `Women Team ${index + 1}`,
  isDeleted: false,
}));
const teams = teamIds.map((id, index) => ({
  _id: id,
  name: `Women Team ${index + 1}`,
  logo: `/team-${index + 1}.png`,
  city: 'Lokoja',
  registrationStatus: 'registered',
  division: CompetitionDivision.WOMEN,
}));

const womenTournament = (
  workflowState = CompetitionWorkflowState.ENTRIES_READY,
  workflowRevision = 3
) => ({
  _id: tournamentId,
  name: 'Solid FM Women Cup',
  season: '2026',
  formatVersion: 3,
  format: TournamentFormat.SINGLE_TABLE_FINAL,
  division: CompetitionDivision.WOMEN,
  workflowState,
  workflowRevision,
  standingsRevision: workflowRevision,
  startDate: new Date('2026-09-01T00:00:00.000Z'),
  competitionRules: {
    ...FIXED_WOMENS_COMPETITION_RULES,
    tieBreakers: [...FIXED_WOMENS_COMPETITION_RULES.tieBreakers],
  },
  qualificationSnapshot: [],
  toObject() {
    return { ...this };
  },
});

const leagueFixtures = [
  {
    officialNumber: 1,
    homeEntryId: entryIds[0].toString(),
    awayEntryId: entryIds[1].toString(),
    kickoffAt: null,
    venue: null,
  },
  {
    officialNumber: 2,
    homeEntryId: entryIds[2].toString(),
    awayEntryId: entryIds[0].toString(),
    kickoffAt: null,
    venue: null,
  },
  {
    officialNumber: 3,
    homeEntryId: entryIds[1].toString(),
    awayEntryId: entryIds[2].toString(),
    kickoffAt: null,
    venue: null,
  },
];

const mockedFenceTeamLifecycle = fenceTeamLifecycle as jest.MockedFunction<
  typeof fenceTeamLifecycle
>;
const mockedFenceTeamLifecycles = fenceTeamLifecycles as jest.MockedFunction<
  typeof fenceTeamLifecycles
>;

describe('women competition service state machine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFenceTeamLifecycle.mockResolvedValue(teams[0] as never);
    mockedFenceTeamLifecycles.mockResolvedValue(
      new Map(teams.map((team) => [team._id.toString(), team])) as never
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('adds only a women team and returns tableSlot without compatibility group fields', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    jest.spyOn(Tournament, 'findOne').mockReturnValue(
      queryResult(womenTournament(CompetitionWorkflowState.SETUP, 0)) as never
    );
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult([]) as never);
    const createdDocument = {
      _id: entryIds[0],
      tournamentId,
      teamId: teamIds[0],
      groupKey: 'A',
      groupSlot: 1,
      status: TournamentEntryStatus.ACTIVE,
      source: TournamentEntrySource.ADMIN,
      toObject() {
        return {
          _id: this._id,
          tournamentId: this.tournamentId,
          teamId: this.teamId,
          groupKey: this.groupKey,
          groupSlot: this.groupSlot,
          status: this.status,
          source: this.source,
        };
      },
    };
    jest.spyOn(TournamentEntry, 'create').mockResolvedValue([createdDocument] as never);
    jest
      .spyOn(Tournament, 'findOneAndUpdate')
      .mockReturnValue(queryResult({ workflowRevision: 1 }) as never);

    const result = await addWomensEntry(
      tournamentId.toString(),
      teamIds[0].toString(),
      0,
      adminId
    );

    expect(result).toEqual({
      entry: expect.objectContaining({
        _id: entryIds[0],
        teamId: teamIds[0],
        tableSlot: 1,
      }),
      workflowRevision: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/groupKey|groupSlot/);
  });

  it('rejects men-team enrollment and the fourth women entry before inserting', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    jest.spyOn(Tournament, 'findOne').mockReturnValue(
      queryResult(womenTournament(CompetitionWorkflowState.SETUP, 0)) as never
    );
    const create = jest.spyOn(TournamentEntry, 'create');
    mockedFenceTeamLifecycle.mockResolvedValueOnce({
      ...teams[0],
      division: CompetitionDivision.MEN,
    } as never);
    await expect(
      addWomensEntry(tournamentId.toString(), teamIds[0].toString(), 0, adminId)
    ).rejects.toMatchObject<Partial<CompetitionError>>({
      code: 'TEAM_DIVISION_MISMATCH',
      statusCode: 409,
    });

    jest.restoreAllMocks();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    jest.spyOn(Tournament, 'findOne').mockReturnValue(
      queryResult(womenTournament(CompetitionWorkflowState.ENTRIES_READY, 3)) as never
    );
    mockedFenceTeamLifecycle.mockResolvedValue(teams[0] as never);
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult(entries) as never);
    const secondCreate = jest.spyOn(TournamentEntry, 'create');
    await expect(
      addWomensEntry(tournamentId.toString(), new Types.ObjectId().toString(), 3, adminId)
    ).rejects.toMatchObject<Partial<CompetitionError>>({
      code: 'ENTRY_LIMIT_REACHED',
      statusCode: 409,
    });
    expect(create).not.toHaveBeenCalled();
    expect(secondCreate).not.toHaveBeenCalled();
  });

  it('sanitizes list responses and rejects the women endpoint for a men tournament', async () => {
    const tournamentFind = jest.spyOn(Tournament, 'findOne');
    tournamentFind.mockReturnValueOnce(queryResult(womenTournament()) as never);
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult(entries) as never);
    const rows = await listWomensEntries(tournamentId.toString());
    expect(rows.map((row) => row.tableSlot)).toEqual([1, 2, 3]);
    expect(JSON.stringify(rows)).not.toMatch(/groupKey|groupSlot/);

    tournamentFind.mockReturnValueOnce(
      queryResult({
        ...womenTournament(),
        formatVersion: 2,
        format: TournamentFormat.TWO_GROUP_KNOCKOUT,
        division: CompetitionDivision.MEN,
      }) as never
    );
    await expect(
      previewWomensLeagueFixtures(tournamentId.toString(), {
        expectedRevision: 3,
        fixtures: leagueFixtures,
      })
    ).rejects.toMatchObject<Partial<CompetitionError>>({ code: 'NOT_WOMENS_COMPETITION' });
  });

  it('publishes an all-TBC league atomically, sequentially, and replays safely', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(womenTournament()) as never);
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult(entries) as never);
    jest.spyOn(Venue, 'find').mockReturnValue(queryResult([]) as never);
    jest.spyOn(Team, 'find').mockReturnValue(queryResult(teams) as never);

    const preview = await previewWomensLeagueFixtures(tournamentId.toString(), {
      expectedRevision: 3,
      sourceReference: 'physical-sheet-women-1',
      fixtures: leagueFixtures,
    });
    expect(preview).toMatchObject({ confirmedCount: 0, pendingCount: 3 });

    const request = {
      expectedRevision: 3,
      sourceReference: 'physical-sheet-women-1',
      fixtures: leagueFixtures,
      planHash: preview.planHash,
    };
    const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const operationFind = jest
      .spyOn(CompetitionOperation, 'findOne')
      .mockReturnValueOnce(queryResult(null) as never);
    jest.spyOn(CompetitionOperation, 'create').mockResolvedValue([] as never);
    jest
      .spyOn(CompetitionOperation, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never);

    const sequential = { active: false, order: [] as string[] };
    jest.spyOn(Match, 'exists').mockReturnValue(
      sequentialSessionResult('matches', null, sequential) as never
    );
    jest.spyOn(Standings, 'exists').mockReturnValue(
      sequentialSessionResult('standings', null, sequential) as never
    );
    jest.spyOn(TournamentRosterEntry, 'exists').mockReturnValue(
      sequentialSessionResult('rosters', null, sequential) as never
    );
    jest.spyOn(CompetitionDraw, 'exists').mockReturnValue(
      sequentialSessionResult('draws', null, sequential) as never
    );
    jest.spyOn(CompetitionBracket, 'exists').mockReturnValue(
      sequentialSessionResult('brackets', null, sequential) as never
    );
    jest.spyOn(WomensCompetitionFinal, 'exists').mockReturnValue(
      sequentialSessionResult('finals', null, sequential) as never
    );
    jest.spyOn(PlayerStats, 'exists').mockReturnValue(
      sequentialSessionResult('player-stats', null, sequential) as never
    );
    jest.spyOn(Player, 'find').mockReturnValue(queryResult([]) as never);
    const insertMatches = jest.spyOn(Match, 'insertMany').mockResolvedValue([] as never);
    jest.spyOn(Standings, 'insertMany').mockResolvedValue([] as never);
    jest
      .spyOn(Tournament, 'findOneAndUpdate')
      .mockReturnValue(queryResult({ workflowRevision: 4 }) as never);

    const published = await publishWomensLeagueFixtures(
      tournamentId.toString(),
      request,
      adminId,
      'publish-women-league-1'
    );
    expect(published).toMatchObject({
      replayed: false,
      data: { fixtureCount: 3, confirmedCount: 0, pendingCount: 3, workflowRevision: 4 },
    });
    expect(sequential.order).toEqual([
      'matches',
      'standings',
      'rosters',
      'draws',
      'brackets',
      'finals',
      'player-stats',
    ]);
    expect(insertMatches.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: MatchStage.LEAGUE,
          leg: 1,
          scheduleStatus: MatchScheduleStatus.PENDING,
          fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
        }),
      ])
    );

    const storedResult = published.data;
    operationFind.mockReturnValueOnce(
      queryResult({
        requestHash,
        status: CompetitionOperationStatus.COMPLETED,
        result: storedResult,
      }) as never
    );
    await expect(
      publishWomensLeagueFixtures(
        tournamentId.toString(),
        request,
        adminId,
        'publish-women-league-1'
      )
    ).resolves.toEqual({ data: storedResult, replayed: true });
    expect(mongoose.startSession).toHaveBeenCalledTimes(1);

    operationFind.mockReturnValueOnce(
      queryResult({
        requestHash,
        status: CompetitionOperationStatus.COMPLETED,
        result: storedResult,
      }) as never
    );
    await expect(
      publishWomensLeagueFixtures(
        tournamentId.toString(),
        { ...request, sourceReference: 'changed-sheet' },
        adminId,
        'publish-women-league-1'
      )
    ).rejects.toMatchObject<Partial<CompetitionError>>({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('refuses a cross-tournament physical scheduling collision', async () => {
    jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(womenTournament()) as never);
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult(entries) as never);
    jest.spyOn(Venue, 'find').mockReturnValue(
      queryResult([{ _id: new Types.ObjectId(), name: 'Tribu Arena', __v: 0 }]) as never
    );
    jest.spyOn(Team, 'find').mockReturnValue(queryResult(teams) as never);
    const scheduledFixtures = leagueFixtures.map((fixture, index) =>
      index === 0
        ? {
            ...fixture,
            kickoffAt: '2026-09-10T15:00:00+01:00',
            venue: 'Tribu Arena',
          }
        : fixture
    );
    const preview = await previewWomensLeagueFixtures(tournamentId.toString(), {
      expectedRevision: 3,
      fixtures: scheduledFixtures,
    });

    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    jest.spyOn(CompetitionOperation, 'findOne').mockReturnValue(queryResult(null) as never);
    jest.spyOn(CompetitionOperation, 'create').mockResolvedValue([] as never);
    jest.spyOn(CompetitionOperation, 'updateOne').mockResolvedValue({} as never);
    jest.spyOn(Venue, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    jest.spyOn(Match, 'find').mockReturnValue(
      queryResult([
        {
          tournamentId: new Types.ObjectId(),
          homeTeam: new Types.ObjectId(),
          awayTeam: new Types.ObjectId(),
          date: new Date('2026-09-10T14:00:00.000Z'),
          venue: 'Tribu Arena',
        },
      ]) as never
    );

    await expect(
      publishWomensLeagueFixtures(
        tournamentId.toString(),
        { expectedRevision: 3, fixtures: scheduledFixtures, planHash: preview.planHash },
        adminId,
        'women-global-collision'
      )
    ).rejects.toMatchObject<Partial<CompetitionError>>({
      code: 'WOMENS_EXISTING_VENUE_COLLISION',
      statusCode: 422,
    });
  });

  it('finalizes the completed physical league, locks all results, and never regresses standings revision', async () => {
    const completedMatches = leagueFixtures.map((fixture, index) => ({
      _id: new Types.ObjectId(),
      tournamentId,
      homeTeam: entries.find((entry) => entry._id.toString() === fixture.homeEntryId)!
        .teamId,
      awayTeam: entries.find((entry) => entry._id.toString() === fixture.awayEntryId)!
        .teamId,
      homeScore: index === 0 ? 2 : 1,
      awayScore: 0,
      status: MatchStatus.COMPLETED,
      scheduleStatus: MatchScheduleStatus.CONFIRMED,
      date: new Date(Date.UTC(2026, 8, 10 + index, 14)),
      venue: 'Tribu Arena',
      stage: MatchStage.LEAGUE,
      leg: 1,
      officialFixtureNumber: fixture.officialNumber,
      fixtureKey: `${tournamentId}:league:official:${fixture.officialNumber}`,
      fixturePublicationHash: 'd'.repeat(64),
      fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
    }));
    const tournament = {
      ...womenTournament(CompetitionWorkflowState.GROUP_STAGE, 4),
      standingsRevision: 20,
      competitionTieResolutions: [],
    };
    jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(tournament) as never);
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult(entries) as never);
    jest.spyOn(Match, 'find').mockReturnValue(queryResult(completedMatches) as never);
    jest.spyOn(Team, 'find').mockReturnValue(queryResult(teams) as never);
    jest.spyOn(Match, 'countDocuments').mockReturnValue(queryResult(0) as never);
    const lockResults = jest
      .spyOn(Match, 'updateMany')
      .mockResolvedValue({ modifiedCount: 3 } as never);
    const persistStandings = jest
      .spyOn(Standings, 'bulkWrite')
      .mockResolvedValue({ modifiedCount: 3 } as never);
    const tournamentUpdate = jest
      .spyOn(Tournament, 'findOneAndUpdate')
      .mockReturnValue(queryResult({ workflowRevision: 5 }) as never);
    jest.spyOn(CompetitionOperation, 'findOne').mockReturnValue(queryResult(null) as never);
    jest.spyOn(CompetitionOperation, 'create').mockResolvedValue([] as never);
    jest
      .spyOn(CompetitionOperation, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never);
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);

    const result = await finalizeWomensQualification(
      tournamentId.toString(),
      4,
      'finalize-women-top-two'
    );

    expect(result).toMatchObject({
      replayed: false,
      data: {
        workflowRevision: 5,
        qualified: [
          expect.objectContaining({
            rank: 1,
            teamId: teamIds[0].toString(),
            scope: 'table',
          }),
          expect.objectContaining({
            rank: 2,
            teamId: teamIds[2].toString(),
            scope: 'table',
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/groupKey|groupSlot/);
    expect(lockResults).toHaveBeenCalledWith(
      expect.objectContaining({ resultLockedAt: { $exists: false } }),
      expect.objectContaining({
        $set: expect.objectContaining({ resultLockReason: 'qualification_finalized' }),
      }),
      { session }
    );
    expect(persistStandings).toHaveBeenCalled();
    expect(tournamentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ workflowRevision: 4 }),
      expect.objectContaining({
        $set: expect.objectContaining({
          workflowState: CompetitionWorkflowState.QUALIFICATION_FINALIZED,
          standingsRevision: 21,
        }),
      }),
      expect.objectContaining({ session })
    );
  });

  it('records a physical committee table-tie order without leaking a fake group', async () => {
    const tiedMatches = leagueFixtures.map((fixture, index) => ({
      _id: new Types.ObjectId(),
      tournamentId,
      homeTeam: entries.find((entry) => entry._id.toString() === fixture.homeEntryId)!
        .teamId,
      awayTeam: entries.find((entry) => entry._id.toString() === fixture.awayEntryId)!
        .teamId,
      homeScore: 0,
      awayScore: 0,
      status: MatchStatus.COMPLETED,
      scheduleStatus: MatchScheduleStatus.CONFIRMED,
      date: new Date(Date.UTC(2026, 8, 20 + index, 14)),
      venue: 'Tribu Arena',
      fixtureKey: `${tournamentId}:league:official:${fixture.officialNumber}`,
    }));
    let storedResolutions: unknown[] = [];
    const tournamentFind = jest.spyOn(Tournament, 'findOne').mockImplementation(
      () =>
        queryResult({
          ...womenTournament(CompetitionWorkflowState.GROUP_STAGE, 4),
          competitionTieResolutions: storedResolutions,
        }) as never
    );
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult(entries) as never);
    jest.spyOn(Match, 'find').mockReturnValue(queryResult(tiedMatches) as never);
    jest.spyOn(Team, 'find').mockReturnValue(queryResult(teams) as never);

    const rawRanking = await getWomensRankingState(tournamentId.toString());
    expect(rawRanking.unresolvedTies).toHaveLength(1);
    const tie = rawRanking.unresolvedTies[0];

    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const tournamentUpdate = jest.spyOn(Tournament, 'findOneAndUpdate').mockImplementation(
      ((_filter: unknown, update: { $set?: { competitionTieResolutions?: unknown[] } }) => {
        storedResolutions = update.$set?.competitionTieResolutions ?? [];
        return queryResult({ workflowRevision: 5 });
      }) as never
    );
    jest
      .spyOn(Standings, 'bulkWrite')
      .mockResolvedValue({ modifiedCount: 3 } as never);
    const orderedTeamIds = [...tie.teamIds].reverse();
    const result = await resolveWomensTableTie(
      tournamentId.toString(),
      {
        expectedRevision: 4,
        basisHash: tie.basisHash,
        orderedTeamIds,
        method: CompetitionCommitteeDecisionMethod.COIN_TOSS,
      },
      adminId
    );

    expect(result).toEqual(
      expect.objectContaining({
        workflowRevision: 5,
        resolution: expect.objectContaining({
          scope: 'table',
          basisHash: tie.basisHash,
          orderedTeamIds,
          method: CompetitionCommitteeDecisionMethod.COIN_TOSS,
        }),
        ranking: expect.objectContaining({ unresolvedTies: [] }),
      })
    );
    expect(JSON.stringify(result)).not.toMatch(/groupKey|groupSlot/);
    expect(storedResolutions).toHaveLength(1);
    expect(tournamentUpdate).toHaveBeenCalled();
    expect(tournamentFind).toHaveBeenCalled();
  });

  it('publishes a rank-1 versus rank-2 TBC final with durable circular linkage', async () => {
    const qualified = teamIds.slice(0, 2).map((teamId, index) => ({
      tournamentEntryId: entryIds[index],
      teamId,
      groupKey: 'A' as const,
      rank: index + 1,
      points: 6 - index,
      goalDifference: 2 - index,
      goalsFor: 4 - index,
    }));
    const qualifiedTournament = {
      ...womenTournament(CompetitionWorkflowState.QUALIFICATION_FINALIZED, 5),
      qualificationSnapshot: qualified,
    };
    jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(qualifiedTournament) as never);
    const entryFind = jest.spyOn(TournamentEntry, 'find');
    entryFind
      .mockReturnValueOnce(queryResult(entries.slice(0, 2)) as never)
      .mockReturnValue(queryResult(entries.slice(0, 2)) as never);
    jest.spyOn(Team, 'find').mockReturnValue(queryResult(teams.slice(0, 2)) as never);

    const preview = await previewWomensFinal(tournamentId.toString(), {
      expectedRevision: 5,
      sourceReference: 'physical-final-card',
      kickoffAt: null,
      venue: null,
    });
    expect(preview).toMatchObject({
      homeQualificationRank: 1,
      awayQualificationRank: 2,
      homeTeamId: teamIds[0].toString(),
      awayTeamId: teamIds[1].toString(),
      scheduleStatus: MatchScheduleStatus.PENDING,
    });

    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    jest.spyOn(CompetitionOperation, 'findOne').mockReturnValue(queryResult(null) as never);
    jest.spyOn(CompetitionOperation, 'create').mockResolvedValue([] as never);
    jest
      .spyOn(CompetitionOperation, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never);
    jest
      .spyOn(WomensCompetitionFinal, 'exists')
      .mockReturnValue(queryResult(null) as never);
    jest.spyOn(Match, 'exists').mockReturnValue(queryResult(null) as never);
    const createMatch = jest.spyOn(Match, 'create').mockResolvedValue([] as never);
    const createFinal = jest
      .spyOn(WomensCompetitionFinal, 'create')
      .mockResolvedValue([] as never);
    jest
      .spyOn(Tournament, 'findOneAndUpdate')
      .mockReturnValue(queryResult({ workflowRevision: 6 }) as never);

    const published = await publishWomensFinal(
      tournamentId.toString(),
      {
        expectedRevision: 5,
        sourceReference: 'physical-final-card',
        kickoffAt: null,
        venue: null,
        planHash: preview.planHash,
      },
      adminId,
      'publish-women-final-1'
    );
    expect(published).toMatchObject({
      replayed: false,
      data: { workflowRevision: 6, scheduleStatus: MatchScheduleStatus.PENDING },
    });
    const matchRows = createMatch.mock.calls[0][0] as unknown as Array<
      Record<string, unknown>
    >;
    const finalRows = createFinal.mock.calls[0][0] as unknown as Array<
      Record<string, unknown>
    >;
    const matchRow = matchRows[0];
    const finalRow = finalRows[0];
    expect(matchRow.womensFinalId?.toString()).toBe(finalRow._id?.toString());
    expect(finalRow.matchId?.toString()).toBe(matchRow._id?.toString());
    expect(matchRow).toEqual(
      expect.objectContaining({
        homeTeam: teamIds[0].toString(),
        awayTeam: teamIds[1].toString(),
        leg: 1,
        officialFixtureNumber: 4,
        stage: MatchStage.FINAL,
      })
    );
    expect(finalRow.qualifiers).toEqual([
      expect.objectContaining({ rank: 1, teamId: teamIds[0].toString() }),
      expect.objectContaining({ rank: 2, teamId: teamIds[1].toString() }),
    ]);
  });

  it('validates persisted final participants before completing and locks the outcome atomically', async () => {
    const finalStateId = new Types.ObjectId();
    const matchId = new Types.ObjectId();
    const planHash = 'a'.repeat(64);
    const finalState = {
      _id: finalStateId,
      tournamentId,
      matchId,
      status: WomensFinalStatus.PUBLISHED,
      revision: 6,
      qualifiers: [
        { rank: 1, tournamentEntryId: entryIds[0], teamId: teamIds[0] },
        { rank: 2, tournamentEntryId: entryIds[1], teamId: teamIds[1] },
      ],
      planHash,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const finalMatch = {
      _id: matchId,
      tournamentId,
      womensFinalId: finalStateId,
      homeTeam: teamIds[0],
      awayTeam: teamIds[1],
      homeScore: 2,
      awayScore: 1,
      winner: teamIds[0],
      status: MatchStatus.COMPLETED,
      scheduleStatus: MatchScheduleStatus.CONFIRMED,
      date: new Date('2026-10-01T14:00:00.000Z'),
      venue: 'Tribu Arena',
      stage: MatchStage.FINAL,
      leg: 1,
      officialFixtureNumber: 4,
      fixtureKey: `${tournamentId}:final:official:4`,
      fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
      fixturePublicationHash: planHash,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const knockoutTournament = womenTournament(CompetitionWorkflowState.KNOCKOUT_STAGE, 6);
    jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(knockoutTournament) as never);
    jest.spyOn(WomensCompetitionFinal, 'findOne').mockReturnValue(queryResult(finalState) as never);
    jest.spyOn(Match, 'findOne').mockReturnValue(queryResult(finalMatch) as never);
    jest.spyOn(CompetitionOperation, 'findOne').mockReturnValue(queryResult(null) as never);
    jest.spyOn(CompetitionOperation, 'create').mockResolvedValue([] as never);
    jest
      .spyOn(CompetitionOperation, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never);
    jest
      .spyOn(Tournament, 'findOneAndUpdate')
      .mockReturnValue(queryResult({ workflowRevision: 7 }) as never);
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);

    await expect(
      progressWomensFinal(tournamentId.toString(), 6, adminId, 'progress-women-final-1')
    ).resolves.toMatchObject({
      replayed: false,
      data: {
        action: 'competition_completed',
        workflowRevision: 7,
        championTeamId: teamIds[0].toString(),
        runnerUpTeamId: teamIds[1].toString(),
      },
    });
    expect((finalMatch as Record<string, unknown>).resultLockedAt).toBeInstanceOf(Date);
    expect(finalMatch.save).toHaveBeenCalledWith({ session });
    expect(finalState.status).toBe(WomensFinalStatus.CHAMPION_DECIDED);
    expect(finalState.save).toHaveBeenCalledWith({ session });

    jest.restoreAllMocks();
    const corruptState = { ...finalState, status: WomensFinalStatus.PUBLISHED, revision: 6 };
    const corruptMatch = { ...finalMatch, homeTeam: teamIds[2] };
    jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(knockoutTournament) as never);
    jest
      .spyOn(WomensCompetitionFinal, 'findOne')
      .mockReturnValue(queryResult(corruptState) as never);
    jest.spyOn(Match, 'findOne').mockReturnValue(queryResult(corruptMatch) as never);
    jest.spyOn(CompetitionOperation, 'findOne').mockReturnValue(queryResult(null) as never);
    jest.spyOn(CompetitionOperation, 'create').mockResolvedValue([] as never);
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(buildSession() as never);
    await expect(
      progressWomensFinal(tournamentId.toString(), 6, adminId, 'progress-corrupt-final')
    ).rejects.toMatchObject<Partial<CompetitionError>>({
      code: 'PERSISTED_WOMENS_FINAL_INVALID',
    });
  });

  it('returns a flat and nested persisted final plan without group semantics', async () => {
    const finalStateId = new Types.ObjectId();
    const matchId = new Types.ObjectId();
    const planHash = 'b'.repeat(64);
    jest.spyOn(Tournament, 'findOne').mockReturnValue(
      queryResult(womenTournament(CompetitionWorkflowState.KNOCKOUT_STAGE, 6)) as never
    );
    jest.spyOn(WomensCompetitionFinal, 'findOne').mockReturnValue(
      queryResult({
        _id: finalStateId,
        tournamentId,
        matchId,
        status: WomensFinalStatus.PUBLISHED,
        revision: 6,
        qualifiers: [
          { rank: 1, tournamentEntryId: entryIds[0], teamId: teamIds[0] },
          { rank: 2, tournamentEntryId: entryIds[1], teamId: teamIds[1] },
        ],
        planHash,
        sourceReference: 'final-card',
      }) as never
    );
    jest.spyOn(Match, 'findOne').mockReturnValue(
      queryResult({
        _id: matchId,
        tournamentId,
        womensFinalId: finalStateId,
        homeTeam: teamIds[0],
        awayTeam: teamIds[1],
        status: MatchStatus.SCHEDULED,
        scheduleStatus: MatchScheduleStatus.PENDING,
        stage: MatchStage.FINAL,
        leg: 1,
        officialFixtureNumber: 4,
        fixtureKey: `${tournamentId}:final:official:4`,
        fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
        fixturePublicationHash: planHash,
      }) as never
    );
    jest.spyOn(Team, 'find').mockReturnValue(queryResult(teams.slice(0, 2)) as never);
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(
      queryResult(entries.slice(0, 2)) as never
    );

    const plan = await getWomensFinalPlan(tournamentId.toString());
    expect(plan).toEqual(
      expect.objectContaining({
        matchId: matchId.toString(),
        homeTeamName: teams[0].name,
        awayTeamName: teams[1].name,
        kickoffAt: null,
        venue: null,
        fixture: expect.objectContaining({ matchId: matchId.toString() }),
      })
    );
    expect(JSON.stringify(plan)).not.toMatch(/groupKey|groupSlot|Group A/);
  });

  it('fails closed when persisted league provenance is incomplete', async () => {
    jest.spyOn(Tournament, 'findOne').mockReturnValue(
      queryResult(womenTournament(CompetitionWorkflowState.GROUP_STAGE, 4)) as never
    );
    const publicationHash = 'c'.repeat(64);
    jest.spyOn(Match, 'find').mockReturnValue(
      queryResult(
        leagueFixtures.map((fixture, index) => ({
          _id: new Types.ObjectId(),
          tournamentId,
          homeTeam: entries.find(
            (entry) => entry._id.toString() === fixture.homeEntryId
          )!.teamId,
          awayTeam: entries.find(
            (entry) => entry._id.toString() === fixture.awayEntryId
          )!.teamId,
          stage: MatchStage.LEAGUE,
          leg: index === 0 ? 2 : 1,
          officialFixtureNumber: fixture.officialNumber,
          fixtureKey: `${tournamentId}:league:official:${fixture.officialNumber}`,
          fixturePublicationHash: publicationHash,
          fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
          scheduleStatus: MatchScheduleStatus.PENDING,
        }))
      ) as never
    );
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult(entries) as never);
    jest.spyOn(Team, 'find').mockReturnValue(queryResult(teams) as never);
    jest.spyOn(Venue, 'find').mockReturnValue(queryResult([]) as never);
    await expect(getPublishedWomensLeaguePlan(tournamentId.toString())).rejects.toMatchObject<
      Partial<CompetitionError>
    >({ code: 'PERSISTED_WOMENS_FIXTURE_INVALID' });
  });
});
