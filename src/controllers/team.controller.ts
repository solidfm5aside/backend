import { Request, Response } from 'express';
import mongoose, { ClientSession } from 'mongoose';
import Team, { ITeam } from '@/models/team.model';
import { Setting } from '@/models/setting.model';
import logger from '@/utils/logger';
import {
  deleteUploadedImage,
  getManagedCloudinaryPublicId,
  uploadLogo,
} from '@/utils/cloudinary';
import { hasErrorCode } from '@/utils/http-error.util';
import {
  completedCompetitionSnapshotReferencesLogo,
  refreshOpenCompetitionEntryIdentitySnapshots,
} from '@/services/competition-entry-identity.service';
import {
  countActivePlayersForTeam,
  fenceTeamLifecycle,
  findOpenTournamentEntryForTeam,
  TeamLifecycleError,
} from '@/services/team-lifecycle.service';

const REGISTRATION_STATUSES = new Set(['pending', 'registered', 'withdrawn']);
const MAX_PAGE_SIZE = 100;

const parsePositiveInteger = (value: unknown, fallback: number, maximum?: number): number | null => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum && parsed > maximum)) return null;

  return parsed;
};

export const getTeams = async (req: Request, res: Response) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const limit = parsePositiveInteger(req.query.limit, 10, MAX_PAGE_SIZE);
    const registrationStatus = req.query.registrationStatus;

    if (page === null || limit === null) {
      return res.status(400).json({
        success: false,
        message: `Page and limit must be positive integers; limit cannot exceed ${MAX_PAGE_SIZE}`,
      });
    }

    if (
      registrationStatus !== undefined &&
      (typeof registrationStatus !== 'string' ||
        (registrationStatus !== 'all' && !REGISTRATION_STATUSES.has(registrationStatus)))
    ) {
      return res.status(400).json({ success: false, message: 'Invalid registration status' });
    }

    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = { isDeleted: false };
    if (registrationStatus && registrationStatus !== 'all') {
      query.registrationStatus = registrationStatus;
    }

    const teams = await Team.find(query)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1, _id: -1 });

    const total = await Team.countDocuments(query);

    res.status(200).json({
      success: true,
      data: teams,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    logger.error('Get Teams Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teams' });
  }
};

export const getPublicTeams = async (req: Request, res: Response) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const limit = parsePositiveInteger(req.query.limit, 10, MAX_PAGE_SIZE);
    if (page === null || limit === null) {
      return res.status(400).json({
        success: false,
        message: `Page and limit must be positive integers; limit cannot exceed ${MAX_PAGE_SIZE}`,
      });
    }

    const query = { isDeleted: false, registrationStatus: 'registered' as const };
    const [teams, total] = await Promise.all([
      Team.find(query)
        .select('name city stadium colors logo foundedYear registrationStatus')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1, _id: -1 }),
      Team.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: teams,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Get Public Teams Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teams' });
  }
};

export const getTeam = async (req: Request, res: Response) => {
  try {
    const team = await Team.findOne({ _id: req.params.id, isDeleted: false });
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    res.status(200).json({ success: true, data: team });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch team' });
  }
};

export const getPublicTeam = async (req: Request, res: Response) => {
  try {
    const team = await Team.findOne({
      _id: req.params.id,
      isDeleted: false,
      registrationStatus: 'registered',
    }).select('name city stadium colors logo foundedYear registrationStatus');
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    res.status(200).json({ success: true, data: team });
  } catch (error) {
    logger.error('Get Public Team Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch team' });
  }
};

export const createTeam = async (req: Request, res: Response) => {
  let uploadedLogoPublicId: string | undefined;

  try {
    let logoUrl = req.body.logo;

    if (req.file) {
      try {
        const uploadedLogo = await uploadLogo(req.file.buffer, req.body.name);
        logoUrl = uploadedLogo.url;
        uploadedLogoPublicId = uploadedLogo.publicId;
      } catch (uploadError) {
        logger.error('Admin team logo upload failed:', uploadError);
        return res.status(502).json({ success: false, message: 'Failed to upload team logo' });
      }
    }

    const team = await Team.create({
      ...req.body,
      logo: logoUrl,
    });
    res.status(201).json({ success: true, data: team, message: 'Team created successfully' });
  } catch (error: unknown) {
    if (uploadedLogoPublicId) await deleteUploadedImage(uploadedLogoPublicId);
    logger.error('Create Team Error:', error);
    const message = hasErrorCode(error, 11000)
      ? 'Team name already exists'
      : 'Failed to create team';
    res.status(hasErrorCode(error, 11000) ? 409 : 400).json({ success: false, message });
  }
};

export const updateTeam = async (req: Request, res: Response) => {
  let uploadedLogoPublicId: string | undefined;
  let previousLogoPublicId: string | undefined;
  let previousLogoUrl: string | undefined;
  let session: ClientSession | undefined;

  try {
    const updates: Record<string, unknown> = { ...req.body };
    const nameChanged = Object.prototype.hasOwnProperty.call(req.body, 'name');
    const logoChanged =
      req.file !== undefined || Object.prototype.hasOwnProperty.call(req.body, 'logo');
    const identityChanged = logoChanged || nameChanged;
    let identityVersion: number | undefined;
    if (identityChanged) {
      const currentTeam = await Team.findOne({
        _id: req.params.id,
        isDeleted: false,
      }).select('name logo __v');
      if (!currentTeam) {
        return res.status(404).json({ success: false, message: 'Team not found' });
      }
      identityVersion = currentTeam.__v;
      if (logoChanged) {
        previousLogoUrl = currentTeam.logo;
        previousLogoPublicId = getManagedCloudinaryPublicId(currentTeam.logo);
      }

      if (req.file) {
        try {
          const uploadedLogo = await uploadLogo(
            req.file.buffer,
            typeof req.body.name === 'string' ? req.body.name : currentTeam.name
          );
          updates.logo = uploadedLogo.url;
          uploadedLogoPublicId = uploadedLogo.publicId;
        } catch (uploadError) {
          logger.error('Admin team logo replacement failed:', uploadError);
          return res.status(502).json({ success: false, message: 'Failed to upload team logo' });
        }
      }
    }

    const clearFoundedYear =
      Object.prototype.hasOwnProperty.call(req.body, 'foundedYear') &&
      req.body.foundedYear === undefined;
    if (clearFoundedYear) delete updates.foundedYear;
    const persistenceUpdate = {
      $set: updates,
      ...(clearFoundedYear ? { $unset: { foundedYear: 1 } } : {}),
      ...(identityChanged ? { $inc: { __v: 1 } } : {}),
    };

    const deactivatesTeam =
      Object.prototype.hasOwnProperty.call(req.body, 'registrationStatus') &&
      req.body.registrationStatus !== 'registered';
    let team: ITeam | null = null;
    let teamStateChanged = false;

    if (identityChanged || deactivatesTeam) {
      session = await mongoose.startSession();
      const identitySession = session;
      await identitySession.withTransaction(async () => {
        team = null;
        teamStateChanged = false;
        if (deactivatesTeam) {
          const fencedTeam = await fenceTeamLifecycle(
            req.params.id as string,
            identitySession
          );
          if (!fencedTeam) return;

          const openEntry = await findOpenTournamentEntryForTeam(
            fencedTeam._id,
            identitySession
          );
          if (openEntry) {
            throw new TeamLifecycleError(
              `Remove this team from ${openEntry.tournamentName} before changing its registration status.`,
              409,
              'TEAM_HAS_ACTIVE_TOURNAMENT_ENTRY',
              openEntry
            );
          }
        }

        const updatedTeam = await Team.findOneAndUpdate(
          {
            _id: req.params.id,
            isDeleted: false,
            ...(identityChanged ? { __v: identityVersion } : {}),
          },
          persistenceUpdate,
          { new: true, runValidators: true, session: identitySession }
        );
        team = updatedTeam;
        if (!updatedTeam) {
          teamStateChanged = identityChanged;
          return;
        }

        if (identityChanged) {
          await refreshOpenCompetitionEntryIdentitySnapshots(
            updatedTeam._id,
            { name: updatedTeam.name, logo: updatedTeam.logo || undefined },
            identitySession
          );
        }
      });
    } else {
      team = await Team.findOneAndUpdate(
        { _id: req.params.id, isDeleted: false },
        persistenceUpdate,
        { new: true, runValidators: true }
      );
    }
    if (!team) {
      if (uploadedLogoPublicId) await deleteUploadedImage(uploadedLogoPublicId);
      if (teamStateChanged) {
        return res.status(409).json({
          success: false,
          code: 'TEAM_STATE_CHANGED',
          message: 'The team changed during this update. Refresh and retry.',
        });
      }
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    const persistedLogoPublicId = getManagedCloudinaryPublicId(team.logo);
    if (previousLogoPublicId && previousLogoPublicId !== persistedLogoPublicId) {
      try {
        const preservesCompletedHistory =
          previousLogoUrl !== undefined &&
          (await completedCompetitionSnapshotReferencesLogo(
            team._id,
            previousLogoUrl
          ));
        if (!preservesCompletedHistory) await deleteUploadedImage(previousLogoPublicId);
      } catch (cleanupError) {
        // The Team update has already committed. Fail closed by retaining the
        // old asset when snapshot-reference verification is unavailable.
        logger.error('Unable to verify completed team-logo snapshot references:', cleanupError);
      }
    }

    res.status(200).json({ success: true, data: team, message: 'Team updated successfully' });
  } catch (error: unknown) {
    if (uploadedLogoPublicId) await deleteUploadedImage(uploadedLogoPublicId);
    if (error instanceof TeamLifecycleError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
    logger.error('Update Team Error:', error);
    const message = hasErrorCode(error, 11000)
      ? 'Team name already exists'
      : 'Failed to update team';
    res.status(hasErrorCode(error, 11000) ? 409 : 400).json({ success: false, message });
  } finally {
    await session?.endSession();
  }
};

export const deleteTeam = async (req: Request, res: Response) => {
  let session: ClientSession | undefined;
  let team: ITeam | null = null;
  try {
    session = await mongoose.startSession();
    const lifecycleSession = session;
    await lifecycleSession.withTransaction(async () => {
      team = null;
      const fencedTeam = await fenceTeamLifecycle(req.params.id as string, lifecycleSession);
      if (!fencedTeam) return;

      const openEntry = await findOpenTournamentEntryForTeam(
        fencedTeam._id,
        lifecycleSession
      );
      if (openEntry) {
        throw new TeamLifecycleError(
          `Remove this team from ${openEntry.tournamentName} before deleting it.`,
          409,
          'TEAM_HAS_ACTIVE_TOURNAMENT_ENTRY',
          openEntry
        );
      }

      const activePlayerCount = await countActivePlayersForTeam(
        fencedTeam._id,
        lifecycleSession
      );
      if (activePlayerCount > 0) {
        throw new TeamLifecycleError(
          `Transfer or delete this team's ${activePlayerCount} active player${activePlayerCount === 1 ? '' : 's'} before deleting the team.`,
          409,
          'TEAM_HAS_ACTIVE_PLAYERS',
          { activePlayerCount }
        );
      }

      team = await Team.findOneAndUpdate(
        { _id: req.params.id, isDeleted: false },
        { $set: { isDeleted: true } },
        { new: true, session: lifecycleSession }
      );
    });
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    res.status(200).json({ success: true, message: 'Team deleted successfully' });
  } catch (error: unknown) {
    if (error instanceof TeamLifecycleError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
    res.status(400).json({ success: false, message: 'Failed to delete team' });
  } finally {
    await session?.endSession();
  }
};

export const registerTeam = async (req: Request, res: Response) => {
  let uploadedLogoPublicId: string | undefined;

  try {
    const regLiveSetting = await Setting.findOne({ key: 'registration_live' });
    if (!regLiveSetting || (regLiveSetting.value !== 'true' && regLiveSetting.value !== true)) {
      return res.status(403).json({ success: false, message: 'Registration is currently closed by the administrator.' });
    }

    const teamData = req.body;
    let logoUrl = '';

    if (req.file) {
      try {
        const uploadedLogo = await uploadLogo(req.file.buffer, teamData.name);
        logoUrl = uploadedLogo.url;
        uploadedLogoPublicId = uploadedLogo.publicId;
      } catch (uploadError) {
        logger.error('Team registration logo upload failed:', uploadError);
        return res.status(502).json({ success: false, message: 'Failed to upload team logo' });
      }
    }

    const team = await Team.create({
      ...teamData,
      logo: logoUrl || teamData.logo, // Use uploaded URL, fallback to existing or empty
      registrationStatus: 'pending'
    });
    
    logger.info(`New team registration: ${team.name} by ${team.captainName}`);
    
    res.status(201).json({ 
      success: true, 
      data: team, 
      message: 'Registration submitted successfully. We will contact you soon.' 
    });
  } catch (error: unknown) {
    if (uploadedLogoPublicId) await deleteUploadedImage(uploadedLogoPublicId);
    const message = hasErrorCode(error, 11000)
      ? 'Team name already registered'
      : 'Registration failed';
    res.status(hasErrorCode(error, 11000) ? 409 : 400).json({ success: false, message });
  }
};
