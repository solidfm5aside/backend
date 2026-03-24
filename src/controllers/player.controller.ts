import { Request, Response } from 'express';
import Player from '@/models/player.model';
import Team from '@/models/team.model';
import logger from '@/utils/logger';

export const getPlayers = async (req: Request, res: Response) => {
  try {
    const { teamId, page = 1, limit = 10 } = req.query;
    const filter: any = { isDeleted: false };
    if (teamId) filter.teamId = teamId;

    const skip = (Number(page) - 1) * Number(limit);
    const players = await Player.find(filter)
      .populate('teamId', 'name')
      .skip(skip)
      .limit(Number(limit))
      .sort({ name: 1 });

    const total = await Player.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: players,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error('Get Players Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch players' });
  }
};

export const getPlayer = async (req: Request, res: Response) => {
  try {
    const player = await Player.findOne({ _id: req.params.id, isDeleted: false }).populate('teamId', 'name');
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    res.status(200).json({ success: true, data: player });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch player' });
  }
};

export const createPlayer = async (req: Request, res: Response) => {
  try {
    // Check if team exists
    const team = await Team.findOne({ _id: req.body.teamId, isDeleted: false });
    if (!team) {
      return res.status(400).json({ success: false, message: 'Invalid team ID' });
    }

    const player = await Player.create(req.body);
    res.status(201).json({ success: true, data: player, message: 'Player created successfully' });
  } catch (error) {
    logger.error('Create Player Error:', error);
    res.status(400).json({ success: false, message: 'Failed to create player' });
  }
};

export const updatePlayer = async (req: Request, res: Response) => {
  try {
    if (req.body.teamId) {
      const team = await Team.findOne({ _id: req.body.teamId, isDeleted: false });
      if (!team) return res.status(400).json({ success: false, message: 'Invalid team ID' });
    }

    const player = await Player.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      req.body,
      { new: true, runValidators: true }
    );
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    res.status(200).json({ success: true, data: player, message: 'Player updated successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to update player' });
  }
};

export const deletePlayer = async (req: Request, res: Response) => {
  try {
    const player = await Player.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      { isDeleted: true },
      { new: true }
    );
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    res.status(200).json({ success: true, message: 'Player deleted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to delete player' });
  }
};
