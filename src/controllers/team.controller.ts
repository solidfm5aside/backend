import { Request, Response } from 'express';
import Team from '@/models/team.model';
import { Setting } from '@/models/setting.model';
import logger from '@/utils/logger';

export const getTeams = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 10, registrationStatus } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query: any = { isDeleted: false };
    if (registrationStatus && registrationStatus !== 'all') {
      query.registrationStatus = registrationStatus;
    }

    const teams = await Team.find(query)
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Team.countDocuments(query);

    res.status(200).json({
      success: true,
      data: teams,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Get Teams Error:', error);
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
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch team' });
  }
};

export const createTeam = async (req: Request, res: Response) => {
  try {
    const team = await Team.create(req.body);
    res.status(201).json({ success: true, data: team, message: 'Team created successfully' });
  } catch (error: any) {
    logger.error('Create Team Error:', error);
    const message = error.code === 11000 ? 'Team name already exists' : 'Failed to create team';
    res.status(400).json({ success: false, message });
  }
};

export const updateTeam = async (req: Request, res: Response) => {
  try {
    const team = await Team.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      req.body,
      { new: true, runValidators: true }
    );
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    res.status(200).json({ success: true, data: team, message: 'Team updated successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to update team' });
  }
};

export const deleteTeam = async (req: Request, res: Response) => {
  try {
    const team = await Team.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      { isDeleted: true },
      { new: true }
    );
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    res.status(200).json({ success: true, message: 'Team deleted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to delete team' });
  }
};

import { uploadLogo } from '@/utils/cloudinary';

export const registerTeam = async (req: Request, res: Response) => {
  try {
    const regLiveSetting = await Setting.findOne({ key: 'registration_live' });
    if (!regLiveSetting || (regLiveSetting.value !== 'true' && regLiveSetting.value !== true)) {
      return res.status(403).json({ success: false, message: 'Registration is currently closed by the administrator.' });
    }

    const teamData = req.body;
    let logoUrl = '';

    const reqAny = req as any;
    if (reqAny.file) {
      try {
        logoUrl = await uploadLogo(reqAny.file.buffer, teamData.name);
      } catch (uploadError) {
        logger.error('Logo upload failed, proceeding without logo:', uploadError);
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
  } catch (error: any) {
    const message = error.code === 11000 ? 'Team name already registered' : 'Registration failed';
    res.status(400).json({ success: false, message });
  }
};
