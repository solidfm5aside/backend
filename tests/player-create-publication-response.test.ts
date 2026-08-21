jest.mock('@/models/player.model', () => ({
  __esModule: true,
  PlayerPosition: {
    GOALKEEPER: 'GK',
    DEFENDER: 'DF',
    MIDFIELDER: 'MF',
    FORWARD: 'FW',
  },
  default: {},
}));

jest.mock('@/models/team.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('@/services/player-eligibility.service', () => ({
  getOpenPublishedCompetitionsExcludingPlayer: jest.fn(),
  getOpenPublishedCompetitionsForTeam: jest.fn().mockResolvedValue([]),
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
  completedCompetitionSnapshotReferencesPlayerPhoto: jest.fn(),
  updatePlayerMetadataAndOpenRosterSnapshots: jest.fn(),
}));

jest.mock('@/utils/cloudinary', () => ({
  deleteUploadedImage: jest.fn(),
  getManagedCloudinaryPublicId: jest.fn(),
  uploadPassportPic: jest.fn(),
}));

import { Request, Response } from 'express';
import Team from '@/models/team.model';
import { createPlayer } from '@/controllers/player.controller';
import { createPlayerInAvailableRosterSlot } from '@/services/player-roster.service';
import { getOpenPublishedCompetitionsExcludingPlayer } from '@/services/player-eligibility.service';

const TEAM_ID = '507f1f77bcf86cd799439011';
const PLAYER_ID = '507f1f77bcf86cd799439012';
const TOURNAMENT = {
  tournamentId: '507f1f77bcf86cd799439013',
  name: 'Solid FM Cup',
  season: '2026',
  workflowState: 'group_stage',
};

const mockedTeam = Team as unknown as { findOne: jest.Mock };
const mockedCreatePlayer = createPlayerInAvailableRosterSlot as jest.MockedFunction<
  typeof createPlayerInAvailableRosterSlot
>;
const mockedGetExclusions =
  getOpenPublishedCompetitionsExcludingPlayer as jest.MockedFunction<
    typeof getOpenPublishedCompetitionsExcludingPlayer
  >;

const player = {
  _id: { toString: () => PLAYER_ID },
  teamId: { toString: () => TEAM_ID },
};

const buildResponse = () => {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & { status: jest.Mock; json: jest.Mock };
};

const request = {
  body: {
    teamId: TEAM_ID,
    name: 'Ada Okafor',
    position: 'MF',
    jerseyNumber: 8,
    nationality: 'Nigeria',
  },
} as unknown as Request;

describe('create-player eligibility response after the commit boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedTeam.findOne.mockResolvedValue({ _id: TEAM_ID });
    mockedCreatePlayer.mockResolvedValue(player as never);
  });

  it('checks the committed player snapshot and reports the create-first ordering as included', async () => {
    const callOrder: string[] = [];
    mockedCreatePlayer.mockImplementationOnce(async () => {
      callOrder.push('player-commit');
      return player as never;
    });
    mockedGetExclusions.mockImplementationOnce(async () => {
      callOrder.push('eligibility-read');
      return [];
    });
    const response = buildResponse();

    await createPlayer(request, response);

    expect(callOrder).toEqual(['player-commit', 'eligibility-read']);
    expect(mockedGetExclusions).toHaveBeenCalledWith(TEAM_ID, PLAYER_ID);
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        competitionEligibility: expect.objectContaining({
          eligibleForOpenPublishedCompetitions: true,
          excludedTournaments: [],
        }),
        message: 'Player created successfully',
      })
    );
  });

  it('reports the publish-first ordering as future-only from the committed snapshot', async () => {
    mockedGetExclusions.mockResolvedValueOnce([TOURNAMENT as never]);
    const response = buildResponse();

    await createPlayer(request, response);

    expect(mockedGetExclusions).toHaveBeenCalledWith(TEAM_ID, PLAYER_ID);
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        competitionEligibility: expect.objectContaining({
          eligibleForOpenPublishedCompetitions: false,
          excludedTournaments: [TOURNAMENT],
        }),
        message:
          'Player created for future competitions but is not eligible for the already-published tournament roster',
      })
    );
  });

  it('keeps the committed create successful when the post-commit eligibility read fails', async () => {
    mockedGetExclusions.mockRejectedValueOnce(new Error('read unavailable'));
    const response = buildResponse();

    await createPlayer(request, response);

    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        competitionEligibilityUnavailable: true,
      })
    );
  });
});
