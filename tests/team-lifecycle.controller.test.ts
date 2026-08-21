jest.mock('@/models/team.model', () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn() },
}));

jest.mock('@/services/competition-entry-identity.service', () => ({
  refreshOpenCompetitionEntryIdentitySnapshots: jest.fn(),
}));

jest.mock('@/services/team-lifecycle.service', () => {
  const actual = jest.requireActual('@/services/team-lifecycle.service');
  return {
    ...actual,
    countActivePlayersForTeam: jest.fn(),
    fenceTeamLifecycle: jest.fn(),
    findOpenTournamentEntryForTeam: jest.fn(),
  };
});

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Team from '@/models/team.model';
import { deleteTeam, updateTeam } from '@/controllers/team.controller';
import {
  countActivePlayersForTeam,
  fenceTeamLifecycle,
  findOpenTournamentEntryForTeam,
} from '@/services/team-lifecycle.service';

const mockedTeam = Team as unknown as { findOneAndUpdate: jest.Mock };
const mockedFence = fenceTeamLifecycle as jest.MockedFunction<typeof fenceTeamLifecycle>;
const mockedFindOpen = findOpenTournamentEntryForTeam as jest.MockedFunction<
  typeof findOpenTournamentEntryForTeam
>;
const mockedCountPlayers = countActivePlayersForTeam as jest.MockedFunction<
  typeof countActivePlayersForTeam
>;
const mockedSession = {
  endSession: jest.fn().mockResolvedValue(undefined),
  withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()),
};
const startSessionSpy = jest
  .spyOn(mongoose, 'startSession')
  .mockResolvedValue(mockedSession as never);

const buildResponse = () => {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & { status: jest.Mock; json: jest.Mock };
};

describe('team lifecycle controller fences', () => {
  afterAll(() => startSessionSpy.mockRestore());

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFence.mockResolvedValue({ _id: 'team-1' } as never);
    mockedFindOpen.mockResolvedValue(null);
    mockedCountPlayers.mockResolvedValue(0);
  });

  it('blocks withdrawal while an open competition entry exists', async () => {
    mockedFindOpen.mockResolvedValue({
      tournamentId: 'tournament-1',
      tournamentName: 'Open Season',
    });
    const response = buildResponse();

    await updateTeam(
      {
        params: { id: 'team-1' },
        body: { registrationStatus: 'withdrawn' },
      } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TEAM_HAS_ACTIVE_TOURNAMENT_ENTRY' })
    );
    expect(mockedFence).toHaveBeenCalledWith('team-1', mockedSession);
    expect(mockedTeam.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('persists a status-only approval and returns the registered database record', async () => {
    const registeredTeam = {
      _id: 'team-1',
      registrationStatus: 'registered',
    };
    mockedTeam.findOneAndUpdate.mockResolvedValue(registeredTeam);
    const response = buildResponse();

    await updateTeam(
      {
        params: { id: 'team-1' },
        body: { registrationStatus: 'registered' },
      } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: registeredTeam,
      message: 'Team updated successfully',
    });
    expect(mockedTeam.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'team-1', isDeleted: false },
      { $set: { registrationStatus: 'registered' } },
      { new: true, runValidators: true }
    );
    expect(startSessionSpy).not.toHaveBeenCalled();
  });

  it('blocks deletion until active players have been transferred or deleted', async () => {
    mockedCountPlayers.mockResolvedValue(2);
    const response = buildResponse();

    await deleteTeam(
      { params: { id: 'team-1' } } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'TEAM_HAS_ACTIVE_PLAYERS',
        details: { activePlayerCount: 2 },
      })
    );
    expect(mockedTeam.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('soft-deletes only after the dependency checks pass in the same transaction', async () => {
    mockedTeam.findOneAndUpdate.mockResolvedValue({ _id: 'team-1', isDeleted: true });
    const response = buildResponse();

    await deleteTeam(
      { params: { id: 'team-1' } } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(mockedTeam.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'team-1', isDeleted: false },
      { $set: { isDeleted: true } },
      { new: true, session: mockedSession }
    );
    expect(mockedFence.mock.invocationCallOrder[0]).toBeLessThan(
      mockedFindOpen.mock.invocationCallOrder[0]
    );
    expect(mockedFindOpen.mock.invocationCallOrder[0]).toBeLessThan(
      mockedCountPlayers.mock.invocationCallOrder[0]
    );
    expect(mockedCountPlayers.mock.invocationCallOrder[0]).toBeLessThan(
      mockedTeam.findOneAndUpdate.mock.invocationCallOrder[0]
    );
  });
});
