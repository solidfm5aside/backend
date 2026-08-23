import { Request, Response } from 'express';
import { QueryFilter } from 'mongoose';
import Player, { IPlayer } from '@/models/player.model';
import Team from '@/models/team.model';
import Tournament, { TournamentFormat } from '@/models/tournament.model';
import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import logger from '@/utils/logger';
import {
  deleteUploadedImage,
  getManagedCloudinaryPublicId,
  uploadPassportPic,
} from '@/utils/cloudinary';
import {
  getOpenPublishedCompetitionsExcludingPlayer,
  getOpenRosterLocksForPlayer,
  OpenCompetitionReference,
} from '@/services/player-eligibility.service';
import { isPlayerTeamTransfer } from '@/utils/roster.util';
import {
  createPlayerInAvailableRosterSlot,
  PlayerRosterError,
  transferPlayerToAvailableRosterSlot,
} from '@/services/player-roster.service';
import {
  completedCompetitionSnapshotReferencesPlayerPhoto,
  updatePlayerMetadataAndOpenRosterSnapshots,
} from '@/services/player-roster-identity.service';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const MAX_PAGE_SIZE = 100;
const ROSTER_SNAPSHOT_FIELDS = ['name', 'position', 'jerseyNumber', 'nationality'] as const;

const rosterRevisionFilter = (revision: number) =>
  revision === 0
    ? {
        $or: [
          { competitionRosterRevision: 0 },
          { competitionRosterRevision: { $exists: false } },
        ],
      }
    : { competitionRosterRevision: revision };

const rosterLockResponse = (
  res: Response,
  action: 'transfer' | 'delete',
  tournaments: OpenCompetitionReference[]
) =>
  res.status(409).json({
    success: false,
    code: 'PLAYER_ROSTER_LOCKED',
    message:
      `This player cannot be ${action === 'transfer' ? 'transferred' : 'deleted'} while ` +
      'listed on an open tournament roster. Complete the tournament first.',
    details: { tournaments },
  });

const competitionEligibility = (tournaments: OpenCompetitionReference[]) => ({
  eligibleForOpenPublishedCompetitions: tournaments.length === 0,
  reason:
    tournaments.length === 0
      ? null
      : 'The tournament roster was already published; this player is available for future competitions only.',
  excludedTournaments: tournaments,
});

const parsePositiveInteger = (value: unknown, fallback: number, maximum?: number): number | null => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum && parsed > maximum)) return null;

  return parsed;
};

export const getPlayers = async (req: Request, res: Response) => {
  try {
    const { teamId, tournamentId } = req.query;
    const page = parsePositiveInteger(req.query.page, 1);
    const limit = parsePositiveInteger(req.query.limit, 10, MAX_PAGE_SIZE);

    if (page === null || limit === null) {
      return res.status(400).json({
        success: false,
        message: `Page and limit must be positive integers; limit cannot exceed ${MAX_PAGE_SIZE}`,
      });
    }

    if (teamId !== undefined && (typeof teamId !== 'string' || !OBJECT_ID_PATTERN.test(teamId))) {
      return res.status(400).json({ success: false, message: 'Invalid team ID' });
    }
    if (
      tournamentId !== undefined &&
      (typeof tournamentId !== 'string' || !OBJECT_ID_PATTERN.test(tournamentId))
    ) {
      return res.status(400).json({ success: false, message: 'Invalid tournament ID' });
    }

    const filter: QueryFilter<IPlayer> = { isDeleted: false };
    let usesPublishedTournamentRoster = false;
    if (tournamentId) {
      const tournament = await Tournament.findOne({
        _id: tournamentId,
        isDeleted: false,
      })
        .select('formatVersion format fixturesGenerated')
        .lean();
      if (!tournament) {
        return res.status(404).json({ success: false, message: 'Tournament not found' });
      }
      usesPublishedTournamentRoster =
        ((tournament.formatVersion === 2 &&
          tournament.format === TournamentFormat.TWO_GROUP_KNOCKOUT) ||
          (tournament.formatVersion === 3 &&
            tournament.format === TournamentFormat.SINGLE_TABLE_FINAL)) &&
        tournament.fixturesGenerated;
      if (usesPublishedTournamentRoster) {
        const rosterFilter: Record<string, unknown> = { tournamentId };
        if (teamId) rosterFilter.teamId = teamId;
        filter._id = {
          $in: await TournamentRosterEntry.find(rosterFilter).distinct('playerId'),
        };
      }
    }
    if (teamId && !usesPublishedTournamentRoster) filter.teamId = teamId;

    const skip = (page - 1) * limit;
    const players = await Player.find(filter)
      .populate('teamId', 'name division')
      .skip(skip)
      .limit(limit)
      .sort({ name: 1, _id: 1 });

    const total = await Player.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: players,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Get Players Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch players' });
  }
};

export const getPublicPlayers = async (req: Request, res: Response) => {
  try {
    const { teamId } = req.query;
    const page = parsePositiveInteger(req.query.page, 1);
    const limit = parsePositiveInteger(req.query.limit, 10, MAX_PAGE_SIZE);
    if (page === null || limit === null) {
      return res.status(400).json({
        success: false,
        message: `Page and limit must be positive integers; limit cannot exceed ${MAX_PAGE_SIZE}`,
      });
    }
    if (teamId !== undefined && (typeof teamId !== 'string' || !OBJECT_ID_PATTERN.test(teamId))) {
      return res.status(400).json({ success: false, message: 'Invalid team ID' });
    }

    const activeTeamFilter = {
      isDeleted: false,
      registrationStatus: 'registered' as const,
    };
    const activeTeamIds = teamId
      ? (await Team.exists({ _id: teamId, ...activeTeamFilter }) ? [teamId] : [])
      : await Team.find(activeTeamFilter).distinct('_id');
    const filter: Record<string, unknown> = {
      isDeleted: false,
      teamId: { $in: activeTeamIds },
    };
    const [players, total] = await Promise.all([
      Player.find(filter)
        .select('name position jerseyNumber nationality teamId')
        .populate('teamId', 'name logo division')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ name: 1, _id: 1 }),
      Player.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: players,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error('Get Public Players Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch players' });
  }
};

export const getPlayer = async (req: Request, res: Response) => {
  try {
    const player = await Player.findOne({ _id: req.params.id, isDeleted: false }).populate('teamId', 'name division');
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    res.status(200).json({ success: true, data: player });
  } catch (_error) {
    res.status(500).json({ success: false, message: 'Failed to fetch player' });
  }
};

export const getPublicPlayer = async (req: Request, res: Response) => {
  try {
    const player = await Player.findOne({ _id: req.params.id, isDeleted: false })
      .select('name position jerseyNumber nationality teamId')
      .populate('teamId', 'name logo division');
    const populatedTeam = player?.teamId as unknown as { _id?: unknown } | undefined;
    const activeTeam = populatedTeam?._id
      ? await Team.exists({
          _id: populatedTeam._id,
          isDeleted: false,
          registrationStatus: 'registered',
        })
      : null;
    if (!player || !activeTeam) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    res.status(200).json({ success: true, data: player });
  } catch (error) {
    logger.error('Get Public Player Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch player' });
  }
};

export const createPlayer = async (req: Request, res: Response) => {
  let uploadedPhotoPublicId: string | undefined;
  let playerCreationSucceeded = false;

  try {
    // Check if team exists
    const team = await Team.findOne({ _id: req.body.teamId, isDeleted: false });
    if (!team) {
      return res.status(400).json({ success: false, message: 'Invalid team ID' });
    }
    const playerData = req.body;
    let passportUrl = '';

    if (req.file) {
      try {
        const uploadedPhoto = await uploadPassportPic(req.file.buffer, playerData.name);
        passportUrl = uploadedPhoto.url;
        uploadedPhotoPublicId = uploadedPhoto.publicId;
      } catch (uploadError) {
        logger.error('Player photo upload failed:', uploadError);
        return res.status(502).json({ success: false, message: 'Failed to upload player photo' });
      }
    }

    const player = await createPlayerInAvailableRosterSlot({
      ...playerData,
      passportPic: passportUrl || playerData.passportPic
    });
    playerCreationSucceeded = true;

    let excludedTournaments: OpenCompetitionReference[] = [];
    let eligibilityUnavailable = false;
    try {
      excludedTournaments = await getOpenPublishedCompetitionsExcludingPlayer(
        player.teamId.toString(),
        player._id.toString()
      );
    } catch (eligibilityError) {
      eligibilityUnavailable = true;
      logger.error(
        'Player creation committed but competition eligibility could not be loaded:',
        eligibilityError
      );
    }

    const eligibility = competitionEligibility(excludedTournaments);
    res.status(201).json({
      success: true,
      data: player,
      ...(!eligibilityUnavailable ? { competitionEligibility: eligibility } : {}),
      ...(eligibilityUnavailable ? { competitionEligibilityUnavailable: true } : {}),
      message: eligibilityUnavailable
        ? 'Player created successfully; refresh to load tournament eligibility details'
        : eligibility.eligibleForOpenPublishedCompetitions
          ? 'Player created successfully'
          : 'Player created for future competitions but is not eligible for the already-published tournament roster',
    });
  } catch (error) {
    if (uploadedPhotoPublicId && !playerCreationSucceeded) {
      await deleteUploadedImage(uploadedPhotoPublicId);
    }
    logger.error('Create Player Error:', error);
    if (error instanceof PlayerRosterError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    res.status(400).json({ success: false, message: 'Failed to create player' });
  }
};

export const updatePlayer = async (req: Request, res: Response) => {
  let uploadedPhotoPublicId: string | undefined;
  let playerUpdateSucceeded = false;

  try {
    const existing = await Player.findOne({ _id: req.params.id, isDeleted: false }).select(
      '+competitionRosterRevision teamId name passportPic __v'
    );
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    if (req.body.teamId) {
      const team = await Team.findOne({ _id: req.body.teamId, isDeleted: false });
      if (!team) return res.status(400).json({ success: false, message: 'Invalid team ID' });
    }

    const teamTransfer = isPlayerTeamTransfer(
      existing.teamId.toString(),
      req.body.teamId
    );
    const snapshotMetadataChanged = ROSTER_SNAPSHOT_FIELDS.some((field) =>
      Object.prototype.hasOwnProperty.call(req.body, field)
    );
    const imageChanged =
      req.file !== undefined || Object.prototype.hasOwnProperty.call(req.body, 'passportPic');
    const snapshotIdentityChanged = snapshotMetadataChanged || imageChanged;
    const requiresRosterCas = teamTransfer || snapshotIdentityChanged;
    if (teamTransfer) {
      const rosterLocks = await getOpenRosterLocksForPlayer(existing._id.toString());
      if (rosterLocks.length > 0) return rosterLockResponse(res, 'transfer', rosterLocks);
    }

    const updates: Record<string, unknown> = { ...req.body };
    if (req.file) {
      try {
        const uploadedPhoto = await uploadPassportPic(
          req.file.buffer,
          typeof req.body.name === 'string' ? req.body.name : existing.name
        );
        updates.passportPic = uploadedPhoto.url;
        uploadedPhotoPublicId = uploadedPhoto.publicId;
      } catch (uploadError) {
        logger.error('Player photo replacement failed:', uploadError);
        return res.status(502).json({ success: false, message: 'Failed to upload player photo' });
      }
    }

    const updateFilter: QueryFilter<IPlayer> = {
      _id: req.params.id,
      isDeleted: false,
      __v: existing.__v ?? 0,
      ...(requiresRosterCas
        ? {
            teamId: existing.teamId,
            ...rosterRevisionFilter(existing.competitionRosterRevision ?? 0),
          }
        : {}),
    };
    const transferResult = teamTransfer
      ? await transferPlayerToAvailableRosterSlot(updateFilter, updates)
      : {
          player: snapshotIdentityChanged
            ? await updatePlayerMetadataAndOpenRosterSnapshots(updateFilter, updates)
            : await Player.findOneAndUpdate(
                updateFilter,
                {
                  $set: updates,
                  $inc: { __v: 1 },
                },
                {
                  new: true,
                  runValidators: true,
                }
              ),
          rosterIsFull: false,
        };
    const { player } = transferResult;
    if (!player) {
      if (uploadedPhotoPublicId) await deleteUploadedImage(uploadedPhotoPublicId);
      if (transferResult.rosterIsFull) {
        return res.status(409).json({
          success: false,
          code: 'TEAM_ROSTER_FULL',
          message: 'The destination team already has the maximum 10 active players',
        });
      }
      if (teamTransfer) {
        const rosterLocks = await getOpenRosterLocksForPlayer(existing._id.toString());
        if (rosterLocks.length > 0) return rosterLockResponse(res, 'transfer', rosterLocks);
        return res.status(409).json({
          success: false,
          code: 'PLAYER_ROSTER_STATE_CHANGED',
          message: 'Tournament roster eligibility changed during this transfer. Refresh and retry.',
        });
      }
      if (requiresRosterCas) {
        return res.status(409).json({
          success: false,
          code: 'PLAYER_ROSTER_STATE_CHANGED',
          message: 'Tournament roster state changed during this player update. Refresh and retry.',
        });
      }
      return res.status(409).json({
        success: false,
        code: 'PLAYER_STATE_CHANGED',
        message: imageChanged
          ? 'The player photo or profile changed during this update. Refresh and retry.'
          : 'The player changed during this update. Refresh and retry.',
      });
    }
    playerUpdateSucceeded = true;
    const previousPhotoPublicId = imageChanged
      ? getManagedCloudinaryPublicId(existing.passportPic)
      : undefined;
    const persistedPhotoPublicId = getManagedCloudinaryPublicId(player.passportPic);
    if (previousPhotoPublicId && previousPhotoPublicId !== persistedPhotoPublicId) {
      try {
        const preservesCompletedHistory =
          existing.passportPic !== undefined &&
          (await completedCompetitionSnapshotReferencesPlayerPhoto(
            existing._id,
            existing.passportPic
          ));
        if (!preservesCompletedHistory) await deleteUploadedImage(previousPhotoPublicId);
      } catch (cleanupError) {
        logger.error(
          'Unable to verify completed player-photo snapshot references:',
          cleanupError
        );
      }
    }
    let excludedTournaments: OpenCompetitionReference[] = [];
    let eligibilityUnavailable = false;
    if (teamTransfer) {
      try {
        excludedTournaments = await getOpenPublishedCompetitionsExcludingPlayer(
          player.teamId.toString(),
          player._id.toString()
        );
      } catch (eligibilityError) {
        eligibilityUnavailable = true;
        logger.error(
          'Player transfer committed but eligibility details could not be loaded:',
          eligibilityError
        );
      }
    }
    res.status(200).json({
      success: true,
      data: player,
      ...(teamTransfer && !eligibilityUnavailable
        ? { competitionEligibility: competitionEligibility(excludedTournaments) }
        : {}),
      ...(eligibilityUnavailable ? { competitionEligibilityUnavailable: true } : {}),
      message:
        teamTransfer && eligibilityUnavailable
          ? 'Player transferred successfully; refresh to load tournament eligibility details'
          : teamTransfer && excludedTournaments.length > 0
          ? 'Player transferred, but is not eligible for the destination team’s already-published tournament roster'
          : 'Player updated successfully',
    });
  } catch (error) {
    if (uploadedPhotoPublicId && !playerUpdateSucceeded) {
      await deleteUploadedImage(uploadedPhotoPublicId);
    }
    logger.error('Update Player Error:', error);
    if (error instanceof PlayerRosterError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    res.status(400).json({ success: false, message: 'Failed to update player' });
  }
};

export const deletePlayer = async (req: Request, res: Response) => {
  try {
    const existing = await Player.findOne({ _id: req.params.id, isDeleted: false }).select(
      '+competitionRosterRevision'
    );
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    const rosterLocks = await getOpenRosterLocksForPlayer(existing._id.toString());
    if (rosterLocks.length > 0) return rosterLockResponse(res, 'delete', rosterLocks);
    const player = await Player.findOneAndUpdate(
      {
        _id: req.params.id,
        isDeleted: false,
        ...rosterRevisionFilter(existing.competitionRosterRevision ?? 0),
      },
      { isDeleted: true },
      { new: true }
    );
    if (!player) {
      const currentLocks = await getOpenRosterLocksForPlayer(existing._id.toString());
      if (currentLocks.length > 0) return rosterLockResponse(res, 'delete', currentLocks);
      return res.status(409).json({
        success: false,
        code: 'PLAYER_ROSTER_STATE_CHANGED',
        message: 'Tournament roster eligibility changed during deletion. Refresh and retry.',
      });
    }
    res.status(200).json({ success: true, message: 'Player deleted successfully' });
  } catch (_error) {
    res.status(400).json({ success: false, message: 'Failed to delete player' });
  }
};
