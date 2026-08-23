import { Types } from 'mongoose';
import Match, {
  MatchFixtureSource,
  MatchStage,
  MatchStatus,
} from '@/models/match.model';
import Player, { PlayerPosition } from '@/models/player.model';
import Tournament, {
  CompetitionWorkflowState,
  FIXED_WOMENS_COMPETITION_RULES,
  TournamentFormat,
} from '@/models/tournament.model';
import TournamentEntry, {
  TournamentEntryStatus,
} from '@/models/tournament-entry.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import { CompetitionDivision } from '@/models/competition-division';
import {
  enrollPlayerInUnstartedWomensCompetitions,
  WomensLateRosterError,
} from '@/services/womens-late-roster.service';

const queryResult = <T>(value: T) => {
  const promise = Promise.resolve(value);
  const query = {
    select: jest.fn(),
    sort: jest.fn(),
    session: jest.fn(),
    lean: jest.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.session.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  return query;
};

const session = { id: 'transaction-session' };
const playerId = new Types.ObjectId();
const teamId = new Types.ObjectId();
const tournamentId = new Types.ObjectId();
const entryId = new Types.ObjectId();

const player = {
  _id: playerId,
  teamId,
  name: 'Ada Okafor',
  position: PlayerPosition.MIDFIELDER,
  jerseyNumber: 8,
  nationality: 'Nigeria',
  passportPic: 'https://images.example/ada.jpg',
  competitionRosterRevision: 2,
  __v: 5,
  isDeleted: false,
};

const entry = {
  _id: entryId,
  tournamentId,
  teamId,
  status: TournamentEntryStatus.ACTIVE,
  isDeleted: false,
};

const tournament = {
  _id: tournamentId,
  formatVersion: 3,
  format: TournamentFormat.SINGLE_TABLE_FINAL,
  division: CompetitionDivision.WOMEN,
  fixturesGenerated: true,
  workflowState: CompetitionWorkflowState.GROUP_STAGE,
  workflowRevision: 5,
  rosterIdentityRevision: 0,
  competitionRules: {
    ...FIXED_WOMENS_COMPETITION_RULES,
    tieBreakers: [...FIXED_WOMENS_COMPETITION_RULES.tieBreakers],
  },
  __v: 3,
  isDeleted: false,
};

const intactFixture = (officialFixtureNumber: number) => ({
  _id: new Types.ObjectId(),
  tournamentId,
  homeTeam: officialFixtureNumber === 1 ? teamId : new Types.ObjectId(),
  awayTeam: officialFixtureNumber === 1 ? new Types.ObjectId() : teamId,
  homeScore: 0,
  awayScore: 0,
  events: [],
  status: MatchStatus.SCHEDULED,
  stage: MatchStage.LEAGUE,
  leg: 1,
  officialFixtureNumber,
  fixtureKey: `${tournamentId.toString()}:league:official:${officialFixtureNumber}`,
  fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL,
});

const mockEligibleReads = (
  fixtures: Array<Record<string, unknown>> = [intactFixture(1), intactFixture(2)]
) => {
  jest.spyOn(Player, 'findOne').mockReturnValue(queryResult(player) as never);
  jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult([entry]) as never);
  jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(tournament) as never);
  jest.spyOn(TournamentRosterEntry, 'findOne').mockReturnValue(queryResult(null) as never);
  jest.spyOn(Match, 'find').mockReturnValue(queryResult(fixtures) as never);
  jest
    .spyOn(TournamentRosterEntry, 'countDocuments')
    .mockReturnValue(queryResult(0) as never);
};

describe('women v3 late roster enrollment', () => {
  afterEach(() => jest.restoreAllMocks());

  it('CAS-fences the tournament and player while inserting one exact snapshot', async () => {
    mockEligibleReads();
    const order: string[] = [];
    const tournamentFence = jest
      .spyOn(Tournament, 'findOneAndUpdate')
      .mockImplementationOnce(() => {
        order.push('tournament-cas');
        return queryResult({ _id: tournamentId }) as never;
      });
    const snapshotCreate = jest
      .spyOn(TournamentRosterEntry, 'create')
      .mockImplementationOnce(async () => {
        order.push('snapshot-insert');
        return [] as never;
      });
    const playerFence = jest.spyOn(Player, 'updateOne').mockImplementationOnce(() => {
      order.push('player-cas');
      return queryResult({ modifiedCount: 1 }) as never;
    });

    await expect(
      enrollPlayerInUnstartedWomensCompetitions(playerId, teamId, 5, session as never)
    ).resolves.toEqual({
      enrolledTournamentIds: [tournamentId.toString()],
      alreadyEnrolledTournamentIds: [],
      excludedTournamentIds: [],
    });

    expect(order).toEqual(['tournament-cas', 'snapshot-insert', 'player-cas']);
    expect(tournamentFence).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: tournamentId,
        formatVersion: 3,
        format: TournamentFormat.SINGLE_TABLE_FINAL,
        division: CompetitionDivision.WOMEN,
        workflowState: CompetitionWorkflowState.GROUP_STAGE,
        workflowRevision: 5,
        rosterIdentityRevision: 0,
        __v: 3,
      }),
      { $inc: { rosterIdentityRevision: 1, __v: 1 } },
      expect.objectContaining({ session })
    );
    expect(snapshotCreate).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          tournamentId,
          tournamentEntryId: entryId,
          teamId,
          playerId,
          playerNameSnapshot: player.name,
          positionSnapshot: player.position,
          jerseyNumberSnapshot: player.jerseyNumber,
          nationalitySnapshot: player.nationality,
          photoSnapshot: player.passportPic,
          publicationRevision: 5,
        }),
      ],
      { session }
    );
    expect(playerFence).toHaveBeenCalledWith(
      {
        _id: playerId,
        teamId,
        isDeleted: false,
        __v: 5,
        competitionRosterRevision: 2,
      },
      { $inc: { competitionRosterRevision: 1 } },
      { session }
    );
  });

  it('is idempotent when the exact immutable player snapshot already exists', async () => {
    jest.spyOn(Player, 'findOne').mockReturnValue(queryResult(player) as never);
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult([entry]) as never);
    jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(tournament) as never);
    jest.spyOn(TournamentRosterEntry, 'findOne').mockReturnValue(
      queryResult({
        tournamentId,
        tournamentEntryId: entryId,
        teamId,
        playerId,
        playerNameSnapshot: player.name,
        positionSnapshot: player.position,
        jerseyNumberSnapshot: player.jerseyNumber,
        nationalitySnapshot: player.nationality,
        photoSnapshot: player.passportPic,
      }) as never
    );
    const matchRead = jest.spyOn(Match, 'find');
    const snapshotCreate = jest.spyOn(TournamentRosterEntry, 'create');
    const tournamentFence = jest.spyOn(Tournament, 'findOneAndUpdate');
    const playerFence = jest.spyOn(Player, 'updateOne');

    await expect(
      enrollPlayerInUnstartedWomensCompetitions(playerId, teamId, 5, session as never)
    ).resolves.toEqual({
      enrolledTournamentIds: [],
      alreadyEnrolledTournamentIds: [tournamentId.toString()],
      excludedTournamentIds: [],
    });

    expect(matchRead).not.toHaveBeenCalled();
    expect(snapshotCreate).not.toHaveBeenCalled();
    expect(tournamentFence).not.toHaveBeenCalled();
    expect(playerFence).not.toHaveBeenCalled();
  });

  it('fails closed after team play starts and does not mutate eligibility state', async () => {
    mockEligibleReads([
      intactFixture(1),
      { ...intactFixture(2), status: MatchStatus.LIVE },
    ]);
    const snapshotCreate = jest.spyOn(TournamentRosterEntry, 'create');
    const tournamentFence = jest.spyOn(Tournament, 'findOneAndUpdate');
    const playerFence = jest.spyOn(Player, 'updateOne');

    await expect(
      enrollPlayerInUnstartedWomensCompetitions(playerId, teamId, 5, session as never)
    ).resolves.toEqual({
      enrolledTournamentIds: [],
      alreadyEnrolledTournamentIds: [],
      excludedTournamentIds: [tournamentId.toString()],
    });

    expect(snapshotCreate).not.toHaveBeenCalled();
    expect(tournamentFence).not.toHaveBeenCalled();
    expect(playerFence).not.toHaveBeenCalled();
  });

  it('enforces the immutable women tournament snapshot cap of 10', async () => {
    mockEligibleReads();
    (TournamentRosterEntry.countDocuments as jest.Mock).mockReturnValueOnce(
      queryResult(FIXED_WOMENS_COMPETITION_RULES.maxRosterPlayers) as never
    );
    const snapshotCreate = jest.spyOn(TournamentRosterEntry, 'create');
    const tournamentFence = jest.spyOn(Tournament, 'findOneAndUpdate');
    const playerFence = jest.spyOn(Player, 'updateOne');

    await expect(
      enrollPlayerInUnstartedWomensCompetitions(playerId, teamId, 5, session as never)
    ).resolves.toEqual({
      enrolledTournamentIds: [],
      alreadyEnrolledTournamentIds: [],
      excludedTournamentIds: [tournamentId.toString()],
    });

    expect(snapshotCreate).not.toHaveBeenCalled();
    expect(tournamentFence).not.toHaveBeenCalled();
    expect(playerFence).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-zero score', { homeScore: 1 }],
    ['a duplicate official number', { officialFixtureNumber: 1 }],
    ['an invalid fixture key', { fixtureKey: 'wrong-key' }],
    ['an existing result lock', { resultLockedAt: new Date() }],
  ])('rejects publication-state drift caused by %s', async (_label, drift) => {
    mockEligibleReads([intactFixture(1), { ...intactFixture(2), ...drift }]);
    const snapshotCreate = jest.spyOn(TournamentRosterEntry, 'create');

    const result = await enrollPlayerInUnstartedWomensCompetitions(
      playerId,
      teamId,
      5,
      session as never
    );

    expect(result.excludedTournamentIds).toEqual([tournamentId.toString()]);
    expect(snapshotCreate).not.toHaveBeenCalled();
  });

  it('aborts when the exact tournament CAS loses a concurrent race', async () => {
    mockEligibleReads();
    jest.spyOn(Tournament, 'findOneAndUpdate').mockReturnValue(queryResult(null) as never);
    const snapshotCreate = jest.spyOn(TournamentRosterEntry, 'create');

    await expect(
      enrollPlayerInUnstartedWomensCompetitions(playerId, teamId, 5, session as never)
    ).rejects.toMatchObject<Partial<WomensLateRosterError>>({
      code: 'WOMENS_ROSTER_STATE_CHANGED',
      statusCode: 409,
    });
    expect(snapshotCreate).not.toHaveBeenCalled();
  });
});
