import { Request, Response } from 'express';
import Venue from '@/models/venue.model';
import logger from '@/utils/logger';

export const getVenues = async (req: Request, res: Response) => {
  try {
    const venues = await Venue.find({ isDeleted: false }).sort({ importance: 1 });
    res.status(200).json({ success: true, data: venues });
  } catch (error) {
    logger.error('Get Venues Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch venues' });
  }
};

export const getVenue = async (req: Request, res: Response) => {
  try {
    const venue = await Venue.findOne({ _id: req.params.id, isDeleted: false });
    if (!venue) {
      return res.status(404).json({ success: false, message: 'Venue not found' });
    }
    res.status(200).json({ success: true, data: venue });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch venue' });
  }
};

export const createVenue = async (req: Request, res: Response) => {
  try {
    const venue = await Venue.create(req.body);
    res.status(201).json({ success: true, data: venue, message: 'Venue created successfully' });
  } catch (error: any) {
    logger.error('Create Venue Error:', error);
    const message = error.code === 11000 ? 'Venue name already exists' : 'Failed to create venue';
    res.status(400).json({ success: false, message });
  }
};

export const updateVenue = async (req: Request, res: Response) => {
  try {
    const venue = await Venue.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      req.body,
      { new: true, runValidators: true }
    );
    if (!venue) {
      return res.status(404).json({ success: false, message: 'Venue not found' });
    }
    res.status(200).json({ success: true, data: venue, message: 'Venue updated successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to update venue' });
  }
};

export const deleteVenue = async (req: Request, res: Response) => {
  try {
    const venue = await Venue.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      { isDeleted: true },
      { new: true }
    );
    if (!venue) {
      return res.status(404).json({ success: false, message: 'Venue not found' });
    }
    res.status(200).json({ success: true, message: 'Venue deleted successfully' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to delete venue' });
  }
};
