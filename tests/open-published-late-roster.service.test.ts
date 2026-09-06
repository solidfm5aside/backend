import { Types } from 'mongoose';
import Player, { PlayerPosition } from '@/models/player.model';
import Tournament, {
  CompetitionWorkflowState,
  FIXED_V2_COMPETITION_RULES,
  FIXED_WOMENS_COMPETITION_RULES,
  TournamentFormat,
} from '@/models/tournament.model';
import TournamentEntry, {
  TournamentEntryStatus,
} from '@/models/tournament-entry.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import { CompetitionDivision } from '@/models/competition-division';
import {
  enrollPlayerInOpenPublishedCompetitions,
  OpenPublishedLateRosterError,
} from '@/services/open-published-late-roster.service';

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
  name: 'America',
  position: PlayerPosition.MIDFIELDER,
  jerseyNumber: 1,
  nationality: 'Nigeria',
  passportPic: 'https://images.example/america.jpg',
  competitionRosterRevision: 0,
  __v: 0,
  isDeleted: false,
};

const entry = {
  _id: entryId,
  tournamentId,
  teamId,
  status: TournamentEntryStatus.ACTIVE,
  isDeleted: false,
};

const mensTournament = {
  _id: tournamentId,
  formatVersion: 2,
  format: TournamentFormat.TWO_GROUP_KNOCKOUT,
  division: CompetitionDivision.MEN,
  fixturesGenerated: true,
  workflowState: CompetitionWorkflowState.GROUP_STAGE,
  workflowRevision: 8,
  rosterIdentityRevision: 4,
  competitionRules: {
    ...FIXED_V2_COMPETITION_RULES,
    tieBreakers: [...FIXED_V2_COMPETITION_RULES.tieBreakers],
  },
  __v: 11,
  isDeleted: false,
};

const womensTournament = {
  ...mensTournament,
  formatVersion: 3,
  format: TournamentFormat.SINGLE_TABLE_FINAL,
  division: CompetitionDivision.WOMEN,
  competitionRules: {
    ...FIXED_WOMENS_COMPETITION_RULES,
    tieBreakers: [...FIXED_WOMENS_COMPETITION_RULES.tieBreakers],
  },
};

const mockEligibleReads = (tournament: typeof mensTournament) => {
  jest.spyOn(Player, 'findOne').mockReturnValue(queryResult(player) as never);
  jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult([entry]) as never);
  jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(tournament) as never);
  jest.spyOn(TournamentRosterEntry, 'findOne').mockReturnValue(queryResult(null) as never);
  jest
    .spyOn(TournamentRosterEntry, 'countDocuments')
    .mockReturnValue(queryResult(3) as never);
};

describe('open published late roster enrollment', () => {
  afterEach(() => jest.restoreAllMocks());

  it('CAS-fences a started men’s tournament and inserts one exact snapshot', async () => {
    mockEligibleReads(mensTournament);
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
      enrollPlayerInOpenPublishedCompetitions(playerId, teamId, 0, session as never)
    ).resolves.toEqual({
      enrolledTournamentIds: [tournamentId.toString()],
      alreadyEnrolledTournamentIds: [],
      excludedTournamentIds: [],
    });

    expect(order).toEqual(['tournament-cas', 'snapshot-insert', 'player-cas']);
    expect(tournamentFence).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: tournamentId,
        formatVersion: 2,
        format: TournamentFormat.TWO_GROUP_KNOCKOUT,
        workflowRevision: 8,
        rosterIdentityRevision: 4,
        __v: 11,
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
          publicationRevision: 8,
        }),
      ],
      { session }
    );
  });

  it('enrolls a women’s player after league play has already started', async () => {
    mockEligibleReads(womensTournament);
    jest
      .spyOn(Tournament, 'findOneAndUpdate')
      .mockReturnValue(queryResult({ _id: tournamentId }) as never);
    jest.spyOn(TournamentRosterEntry, 'create').mockResolvedValue([] as never);
    jest.spyOn(Player, 'updateOne').mockReturnValue(queryResult({ modifiedCount: 1 }) as never);

    await expect(
      enrollPlayerInOpenPublishedCompetitions(playerId, teamId, 0, session as never)
    ).resolves.toEqual({
      enrolledTournamentIds: [tournamentId.toString()],
      alreadyEnrolledTournamentIds: [],
      excludedTournamentIds: [],
    });
  });

  it('is idempotent when the exact immutable player snapshot already exists', async () => {
    jest.spyOn(Player, 'findOne').mockReturnValue(queryResult(player) as never);
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult([entry]) as never);
    jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(mensTournament) as never);
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
    const snapshotCreate = jest.spyOn(TournamentRosterEntry, 'create');
    const tournamentFence = jest.spyOn(Tournament, 'findOneAndUpdate');
    const playerFence = jest.spyOn(Player, 'updateOne');

    await expect(
      enrollPlayerInOpenPublishedCompetitions(playerId, teamId, 0, session as never)
    ).resolves.toEqual({
      enrolledTournamentIds: [],
      alreadyEnrolledTournamentIds: [tournamentId.toString()],
      excludedTournamentIds: [],
    });

    expect(snapshotCreate).not.toHaveBeenCalled();
    expect(tournamentFence).not.toHaveBeenCalled();
    expect(playerFence).not.toHaveBeenCalled();
  });

  it('skips a completed tournament without mutating eligibility state', async () => {
    jest.spyOn(Player, 'findOne').mockReturnValue(queryResult(player) as never);
    jest.spyOn(TournamentEntry, 'find').mockReturnValue(queryResult([entry]) as never);
    jest.spyOn(Tournament, 'findOne').mockReturnValue(queryResult(null) as never);
    const snapshotCreate = jest.spyOn(TournamentRosterEntry, 'create');

    await expect(
      enrollPlayerInOpenPublishedCompetitions(playerId, teamId, 0, session as never)
    ).resolves.toEqual({
      enrolledTournamentIds: [],
      alreadyEnrolledTournamentIds: [],
      excludedTournamentIds: [],
    });

    expect(snapshotCreate).not.toHaveBeenCalled();
  });

  it('enforces the published tournament roster cap of 10', async () => {
    mockEligibleReads(mensTournament);
    (TournamentRosterEntry.countDocuments as jest.Mock).mockReturnValueOnce(
      queryResult(FIXED_V2_COMPETITION_RULES.maxRosterPlayers) as never
    );
    const snapshotCreate = jest.spyOn(TournamentRosterEntry, 'create');
    const tournamentFence = jest.spyOn(Tournament, 'findOneAndUpdate');

    await expect(
      enrollPlayerInOpenPublishedCompetitions(playerId, teamId, 0, session as never)
    ).resolves.toEqual({
      enrolledTournamentIds: [],
      alreadyEnrolledTournamentIds: [],
      excludedTournamentIds: [tournamentId.toString()],
    });

    expect(snapshotCreate).not.toHaveBeenCalled();
    expect(tournamentFence).not.toHaveBeenCalled();
  });

  it('aborts when the exact tournament CAS loses a concurrent race', async () => {
    mockEligibleReads(mensTournament);
    jest.spyOn(Tournament, 'findOneAndUpdate').mockReturnValue(queryResult(null) as never);
    const snapshotCreate = jest.spyOn(TournamentRosterEntry, 'create');

    await expect(
      enrollPlayerInOpenPublishedCompetitions(playerId, teamId, 0, session as never)
    ).rejects.toMatchObject<Partial<OpenPublishedLateRosterError>>({
      code: 'OPEN_ROSTER_STATE_CHANGED',
      statusCode: 409,
    });
    expect(snapshotCreate).not.toHaveBeenCalled();
  });
});
