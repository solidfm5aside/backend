jest.mock('@/models/player.model', () => ({
  __esModule: true,
  PlayerPosition: {
    GOALKEEPER: 'GK',
    DEFENDER: 'DF',
    MIDFIELDER: 'MF',
    FORWARD: 'FW',
  },
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock('@/models/team.model', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

jest.mock('@/services/player-eligibility.service', () => ({
  getOpenPublishedCompetitionsExcludingPlayer: jest.fn().mockResolvedValue([]),
  getOpenRosterLocksForPlayer: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/services/player-roster.service', () => {
  class PlayerRosterError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
      public readonly code: string
    ) {
      super(message);
    }
  }
  return {
    createPlayerInAvailableRosterSlot: jest.fn(),
    PlayerRosterError,
    transferPlayerToAvailableRosterSlot: jest.fn(),
  };
});

jest.mock('@/services/player-roster-identity.service', () => ({
  updatePlayerMetadataAndOpenRosterSnapshots: jest.fn(),
}));

import { Request, Response } from 'express';
import Player from '@/models/player.model';
import Team from '@/models/team.model';
import { updatePlayer } from '@/controllers/player.controller';
import { transferPlayerToAvailableRosterSlot } from '@/services/player-roster.service';
import { getOpenPublishedCompetitionsExcludingPlayer } from '@/services/player-eligibility.service';
import { updatePlayerMetadataAndOpenRosterSnapshots } from '@/services/player-roster-identity.service';

const SOURCE_TEAM_ID = '507f1f77bcf86cd799439011';
const DESTINATION_TEAM_ID = '507f1f77bcf86cd799439012';
const PLAYER_ID = '507f1f77bcf86cd799439013';

const mockedPlayer = Player as unknown as {
  findOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
};
const mockedTeam = Team as unknown as { findOne: jest.Mock };
const mockedTransferPlayer = transferPlayerToAvailableRosterSlot as jest.MockedFunction<
  typeof transferPlayerToAvailableRosterSlot
>;
const mockedGetOpenPublishedCompetitions =
  getOpenPublishedCompetitionsExcludingPlayer as jest.MockedFunction<
    typeof getOpenPublishedCompetitionsExcludingPlayer
  >;
const mockedMetadataUpdate =
  updatePlayerMetadataAndOpenRosterSnapshots as jest.MockedFunction<
    typeof updatePlayerMetadataAndOpenRosterSnapshots
  >;

const buildResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
};

describe('player roster compare-and-set protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedTeam.findOne.mockResolvedValue({ _id: DESTINATION_TEAM_ID });
    mockedPlayer.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: { toString: () => PLAYER_ID },
        teamId: { toString: () => SOURCE_TEAM_ID },
        name: 'Ada Okafor',
        competitionRosterRevision: 4,
        __v: 7,
      }),
    });
  });

  it('allows one transfer and rejects a stale concurrent transfer instead of overwriting it', async () => {
    mockedTransferPlayer
      .mockResolvedValueOnce({
        rosterIsFull: false,
        player: {
        _id: PLAYER_ID,
        teamId: { toString: () => DESTINATION_TEAM_ID },
        } as never,
      })
      .mockResolvedValueOnce({ player: null, rosterIsFull: false });

    const request = {
      body: { teamId: DESTINATION_TEAM_ID },
      params: { id: PLAYER_ID },
    } as unknown as Request;
    const firstResponse = buildResponse();
    const staleResponse = buildResponse();

    await updatePlayer(request, firstResponse);
    await updatePlayer(request, staleResponse);

    expect(firstResponse.status).toHaveBeenCalledWith(200);
    expect(staleResponse.status).toHaveBeenCalledWith(409);
    expect(staleResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PLAYER_ROSTER_STATE_CHANGED' })
    );
    expect(mockedTransferPlayer).toHaveBeenCalledTimes(2);
    expect(mockedTransferPlayer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        _id: PLAYER_ID,
        isDeleted: false,
        teamId: expect.objectContaining({ toString: expect.any(Function) }),
        competitionRosterRevision: 4,
        __v: 7,
      }),
      expect.objectContaining({ teamId: DESTINATION_TEAM_ID })
    );
  });

  it('rejects a profile edit when tournament publication wins the same roster revision', async () => {
    mockedMetadataUpdate.mockResolvedValueOnce(null);
    const response = buildResponse();

    await updatePlayer(
      {
        body: { name: 'Ada Updated' },
        params: { id: PLAYER_ID },
      } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PLAYER_ROSTER_STATE_CHANGED' })
    );
    expect(mockedMetadataUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: PLAYER_ID,
        isDeleted: false,
        teamId: expect.objectContaining({ toString: expect.any(Function) }),
        competitionRosterRevision: 4,
        __v: 7,
      }),
      expect.objectContaining({ name: 'Ada Updated' })
    );
  });

  it('returns a committed transfer as success when the follow-up eligibility lookup fails', async () => {
    mockedTransferPlayer.mockResolvedValue({
      rosterIsFull: false,
      player: {
        _id: PLAYER_ID,
        teamId: { toString: () => DESTINATION_TEAM_ID },
      } as never,
    });
    mockedGetOpenPublishedCompetitions.mockRejectedValueOnce(new Error('read unavailable'));
    const response = buildResponse();

    await updatePlayer(
      {
        body: { teamId: DESTINATION_TEAM_ID },
        params: { id: PLAYER_ID },
      } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        competitionEligibilityUnavailable: true,
      })
    );
  });

  it('reports an enrolled destination transfer as eligible from the committed snapshot', async () => {
    mockedTransferPlayer.mockResolvedValue({
      rosterIsFull: false,
      player: {
        _id: { toString: () => PLAYER_ID },
        teamId: { toString: () => DESTINATION_TEAM_ID },
      } as never,
    });
    mockedGetOpenPublishedCompetitions.mockResolvedValueOnce([]);
    const response = buildResponse();

    await updatePlayer(
      {
        body: { teamId: DESTINATION_TEAM_ID },
        params: { id: PLAYER_ID },
      } as unknown as Request,
      response
    );

    expect(mockedGetOpenPublishedCompetitions).toHaveBeenCalledWith(
      DESTINATION_TEAM_ID,
      PLAYER_ID
    );
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        competitionEligibility: {
          eligibleForOpenPublishedCompetitions: true,
          reason: null,
          excludedTournaments: [],
        },
      })
    );
  });
});
