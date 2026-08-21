jest.mock('@/models/team.model', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

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

jest.mock('@/utils/cloudinary', () => ({
  __esModule: true,
  deleteUploadedImage: jest.fn().mockResolvedValue(undefined),
  getManagedCloudinaryPublicId: jest.fn((url?: string) => {
    if (url?.includes('old-team')) return 'solidfm/team_logos/old-team';
    if (url?.includes('old-player')) return 'solidfm/player_passports/old-player';
    return undefined;
  }),
  uploadLogo: jest.fn(),
  uploadPassportPic: jest.fn(),
}));

jest.mock('@/services/competition-entry-identity.service', () => ({
  completedCompetitionSnapshotReferencesLogo: jest.fn().mockResolvedValue(false),
  refreshOpenCompetitionEntryIdentitySnapshots: jest.fn().mockResolvedValue(1),
}));

jest.mock('@/services/player-roster-identity.service', () => ({
  completedCompetitionSnapshotReferencesPlayerPhoto: jest.fn().mockResolvedValue(false),
  updatePlayerMetadataAndOpenRosterSnapshots: jest.fn(),
}));

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Team from '@/models/team.model';
import Player from '@/models/player.model';
import { updateTeam } from '@/controllers/team.controller';
import { updatePlayer } from '@/controllers/player.controller';
import {
  deleteUploadedImage,
  uploadLogo,
  uploadPassportPic,
} from '@/utils/cloudinary';
import { refreshOpenCompetitionEntryIdentitySnapshots } from '@/services/competition-entry-identity.service';
import { completedCompetitionSnapshotReferencesLogo } from '@/services/competition-entry-identity.service';
import {
  completedCompetitionSnapshotReferencesPlayerPhoto,
  updatePlayerMetadataAndOpenRosterSnapshots,
} from '@/services/player-roster-identity.service';

const mockedTeam = Team as unknown as {
  findOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
};
const mockedPlayer = Player as unknown as {
  findOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
};
const mockedDeleteUploadedImage = deleteUploadedImage as jest.MockedFunction<typeof deleteUploadedImage>;
const mockedUploadLogo = uploadLogo as jest.MockedFunction<typeof uploadLogo>;
const mockedUploadPassportPic = uploadPassportPic as jest.MockedFunction<typeof uploadPassportPic>;
const mockedRefreshIdentity = refreshOpenCompetitionEntryIdentitySnapshots as jest.MockedFunction<
  typeof refreshOpenCompetitionEntryIdentitySnapshots
>;
const mockedCompletedLogoReference =
  completedCompetitionSnapshotReferencesLogo as jest.MockedFunction<
    typeof completedCompetitionSnapshotReferencesLogo
  >;
const mockedCompletedPhotoReference =
  completedCompetitionSnapshotReferencesPlayerPhoto as jest.MockedFunction<
    typeof completedCompetitionSnapshotReferencesPlayerPhoto
  >;
const mockedUpdatePlayerSnapshots =
  updatePlayerMetadataAndOpenRosterSnapshots as jest.MockedFunction<
    typeof updatePlayerMetadataAndOpenRosterSnapshots
  >;
const mockedSession = {
  endSession: jest.fn().mockResolvedValue(undefined),
  withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()),
};
const startSessionSpy = jest
  .spyOn(mongoose, 'startSession')
  .mockResolvedValue(mockedSession as never);

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

describe('managed image replacement lifecycle', () => {
  afterAll(() => {
    startSessionSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDeleteUploadedImage.mockResolvedValue(undefined);
    mockedCompletedLogoReference.mockResolvedValue(false);
    mockedCompletedPhotoReference.mockResolvedValue(false);
    mockedUpdatePlayerSnapshots.mockImplementation(async (filter, updates) =>
      mockedPlayer.findOneAndUpdate(
        filter,
        { $set: updates, $inc: { competitionRosterRevision: 1, __v: 1 } },
        { new: true, runValidators: true, session: mockedSession }
      )
    );
  });

  it('deletes the previous managed team logo only after its replacement persists', async () => {
    mockedTeam.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        name: 'Solid Stars',
        logo: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/old-team.png',
        __v: 3,
      }),
    });
    mockedUploadLogo.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/new-team.png',
      publicId: 'solidfm/team_logos/new-team',
    });
    mockedTeam.findOneAndUpdate.mockResolvedValue({
      _id: 'team-1',
      name: 'Solid Stars',
      logo: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/new-team.png',
    });

    const request = {
      body: {},
      file: { buffer: Buffer.from('image') },
      params: { id: 'team-1' },
    } as unknown as Request;
    const response = buildResponse();

    await updateTeam(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(mockedDeleteUploadedImage).toHaveBeenCalledWith('solidfm/team_logos/old-team');
    expect(mockedRefreshIdentity).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({ name: 'Solid Stars' }),
      mockedSession
    );
    expect(mockedTeam.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockedRefreshIdentity.mock.invocationCallOrder[0]
    );
    expect(mockedRefreshIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      mockedDeleteUploadedImage.mock.invocationCallOrder[0]
    );
    expect(mockedSession.endSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the old team logo and removes only the new upload when persistence fails', async () => {
    mockedTeam.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        name: 'Solid Stars',
        logo: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/old-team.png',
        __v: 3,
      }),
    });
    mockedUploadLogo.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/new-team.png',
      publicId: 'solidfm/team_logos/new-team',
    });
    mockedTeam.findOneAndUpdate.mockRejectedValue(new Error('database unavailable'));

    const request = {
      body: {},
      file: { buffer: Buffer.from('image') },
      params: { id: 'team-1' },
    } as unknown as Request;
    const response = buildResponse();

    await updateTeam(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(mockedDeleteUploadedImage).toHaveBeenCalledTimes(1);
    expect(mockedDeleteUploadedImage).toHaveBeenCalledWith('solidfm/team_logos/new-team');
    expect(mockedRefreshIdentity).not.toHaveBeenCalled();
  });

  it('preserves an old team logo referenced by a completed competition snapshot', async () => {
    const oldLogo =
      'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/old-team.png';
    mockedTeam.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        name: 'Solid Stars',
        logo: oldLogo,
        __v: 3,
      }),
    });
    mockedUploadLogo.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/new-team.png',
      publicId: 'solidfm/team_logos/new-team',
    });
    mockedTeam.findOneAndUpdate.mockResolvedValue({
      _id: 'team-1',
      name: 'Solid Stars',
      logo: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/new-team.png',
    });
    mockedCompletedLogoReference.mockResolvedValue(true);
    const response = buildResponse();

    await updateTeam(
      {
        body: {},
        file: { buffer: Buffer.from('image') },
        params: { id: 'team-1' },
      } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(mockedCompletedLogoReference).toHaveBeenCalledWith('team-1', oldLogo);
    expect(mockedDeleteUploadedImage).not.toHaveBeenCalled();
  });

  it('treats an explicit empty team logo as removal after persistence', async () => {
    mockedTeam.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        name: 'Solid Stars',
        logo: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/old-team.png',
        __v: 3,
      }),
    });
    mockedTeam.findOneAndUpdate.mockResolvedValue({
      _id: 'team-1',
      name: 'Solid Stars',
      logo: '',
    });
    const response = buildResponse();

    await updateTeam(
      { body: { logo: '' }, params: { id: 'team-1' } } as unknown as Request,
      response
    );

    expect(mockedUploadLogo).not.toHaveBeenCalled();
    expect(mockedDeleteUploadedImage).toHaveBeenCalledWith('solidfm/team_logos/old-team');
    expect(mockedRefreshIdentity).toHaveBeenCalledWith(
      'team-1',
      { name: 'Solid Stars', logo: undefined },
      mockedSession
    );
    expect(mockedTeam.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockedDeleteUploadedImage.mock.invocationCallOrder[0]
    );
  });

  it('does not delete a managed team logo when the persisted public ID is unchanged', async () => {
    const existingLogo =
      'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/old-team.png';
    mockedTeam.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({ name: 'Solid Stars', logo: existingLogo, __v: 3 }),
    });
    mockedTeam.findOneAndUpdate.mockResolvedValue({
      _id: 'team-1',
      name: 'Solid Stars',
      logo: existingLogo,
    });
    const response = buildResponse();

    await updateTeam(
      { body: { logo: existingLogo }, params: { id: 'team-1' } } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(mockedDeleteUploadedImage).not.toHaveBeenCalled();
  });

  it('removes only the losing upload when a concurrent team identity update wins', async () => {
    mockedTeam.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        name: 'Solid Stars',
        logo: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/old-team.png',
        __v: 7,
      }),
    });
    mockedUploadLogo.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/new-team.png',
      publicId: 'solidfm/team_logos/new-team',
    });
    mockedTeam.findOneAndUpdate.mockResolvedValue(null);
    const response = buildResponse();

    await updateTeam(
      {
        body: {},
        file: { buffer: Buffer.from('image') },
        params: { id: 'team-1' },
      } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TEAM_STATE_CHANGED' })
    );
    expect(mockedTeam.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'team-1', __v: 7 }),
      expect.objectContaining({ $inc: { __v: 1 } }),
      expect.anything()
    );
    expect(mockedRefreshIdentity).not.toHaveBeenCalled();
    expect(mockedDeleteUploadedImage).toHaveBeenCalledTimes(1);
    expect(mockedDeleteUploadedImage).toHaveBeenCalledWith(
      'solidfm/team_logos/new-team'
    );
  });

  it('removes a losing team-logo upload when a concurrent identity update wins the version CAS', async () => {
    mockedTeam.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        name: 'Solid Stars',
        logo: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/old-team.png',
        __v: 5,
      }),
    });
    mockedUploadLogo.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/solidfm/team_logos/new-team.png',
      publicId: 'solidfm/team_logos/new-team',
    });
    mockedTeam.findOneAndUpdate.mockResolvedValue(null);
    const response = buildResponse();

    await updateTeam(
      {
        body: {},
        file: { buffer: Buffer.from('image') },
        params: { id: 'team-1' },
      } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TEAM_STATE_CHANGED' })
    );
    expect(mockedTeam.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'team-1', __v: 5 }),
      expect.objectContaining({ $inc: { __v: 1 } }),
      expect.objectContaining({ session: mockedSession })
    );
    expect(mockedDeleteUploadedImage).toHaveBeenCalledTimes(1);
    expect(mockedDeleteUploadedImage).toHaveBeenCalledWith('solidfm/team_logos/new-team');
  });

  it('treats an explicit empty player photo as removal after persistence', async () => {
    mockedPlayer.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: { toString: () => 'player-1' },
        teamId: { toString: () => 'team-1' },
        name: 'Ada Okafor',
        passportPic: 'https://res.cloudinary.com/demo/image/upload/solidfm/player_passports/old-player.png',
        competitionRosterRevision: 0,
        __v: 2,
      }),
    });
    mockedPlayer.findOneAndUpdate.mockResolvedValue({
      _id: 'player-1',
      teamId: { toString: () => 'team-1' },
      passportPic: '',
    });
    const response = buildResponse();

    await updatePlayer(
      { body: { passportPic: '' }, params: { id: 'player-1' } } as unknown as Request,
      response
    );

    expect(mockedUploadPassportPic).not.toHaveBeenCalled();
    expect(mockedDeleteUploadedImage).toHaveBeenCalledWith(
      'solidfm/player_passports/old-player'
    );
    expect(mockedPlayer.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockedDeleteUploadedImage.mock.invocationCallOrder[0]
    );
  });

  it('removes a losing player-photo upload when a concurrent update wins the version CAS', async () => {
    mockedPlayer.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: { toString: () => 'player-1' },
        teamId: { toString: () => 'team-1' },
        name: 'Ada Okafor',
        passportPic:
          'https://res.cloudinary.com/demo/image/upload/solidfm/player_passports/old-player.png',
        competitionRosterRevision: 0,
        __v: 4,
      }),
    });
    mockedUploadPassportPic.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/solidfm/player_passports/new-player.png',
      publicId: 'solidfm/player_passports/new-player',
    });
    mockedPlayer.findOneAndUpdate.mockResolvedValue(null);
    const response = buildResponse();

    await updatePlayer(
      {
        body: {},
        file: { buffer: Buffer.from('image') },
        params: { id: 'player-1' },
      } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PLAYER_ROSTER_STATE_CHANGED' })
    );
    expect(mockedPlayer.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'player-1', __v: 4 }),
      expect.objectContaining({ $inc: { competitionRosterRevision: 1, __v: 1 } }),
      expect.anything()
    );
    expect(mockedDeleteUploadedImage).toHaveBeenCalledTimes(1);
    expect(mockedDeleteUploadedImage).toHaveBeenCalledWith(
      'solidfm/player_passports/new-player'
    );
  });

  it('preserves an old player photo referenced by a completed roster snapshot', async () => {
    const oldPhoto =
      'https://res.cloudinary.com/demo/image/upload/solidfm/player_passports/old-player.png';
    mockedPlayer.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'player-1',
        teamId: { toString: () => 'team-1' },
        name: 'Ada Okafor',
        passportPic: oldPhoto,
        competitionRosterRevision: 2,
        __v: 4,
      }),
    });
    mockedUploadPassportPic.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/solidfm/player_passports/new-player.png',
      publicId: 'solidfm/player_passports/new-player',
    });
    mockedPlayer.findOneAndUpdate.mockResolvedValue({
      _id: 'player-1',
      teamId: { toString: () => 'team-1' },
      passportPic:
        'https://res.cloudinary.com/demo/image/upload/solidfm/player_passports/new-player.png',
    });
    mockedCompletedPhotoReference.mockResolvedValue(true);
    const response = buildResponse();

    await updatePlayer(
      {
        body: {},
        file: { buffer: Buffer.from('image') },
        params: { id: 'player-1' },
      } as unknown as Request,
      response
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(mockedCompletedPhotoReference).toHaveBeenCalledWith('player-1', oldPhoto);
    expect(mockedDeleteUploadedImage).not.toHaveBeenCalled();
  });
});
