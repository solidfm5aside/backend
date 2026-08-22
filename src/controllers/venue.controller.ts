import { Request, Response } from 'express';
import Venue from '@/models/venue.model';
import logger from '@/utils/logger';
import {
  getErrorMessage,
  getErrorStatusCode,
  hasErrorCode,
} from '@/utils/http-error.util';
import {
  deleteVenueSafely,
  updateVenueSafely,
  VenueMutationError,
} from '@/services/venue-lifecycle.service';

export const getVenues = async (req: Request, res: Response) => {
  try {
    const venues = await Venue.find({ isDeleted: false }).sort({ importance: 1 });
    res.status(200).json({ success: true, data: venues });
  } catch (error: unknown) {
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
  } catch {
    res.status(500).json({ success: false, message: 'Failed to fetch venue' });
  }
};

export const createVenue = async (req: Request, res: Response) => {
  try {
    const venue = await Venue.create(req.body);
    res.status(201).json({ success: true, data: venue, message: 'Venue created successfully' });
  } catch (error: unknown) {
    logger.error('Create Venue Error:', error);
    const message = hasErrorCode(error, 11000)
      ? 'Venue name already exists'
      : 'Failed to create venue';
    res.status(400).json({ success: false, message });
  }
};

export const updateVenue = async (req: Request, res: Response) => {
  try {
    const venue = await updateVenueSafely(req.params.id as string, req.body);
    if (!venue) {
      return res.status(404).json({ success: false, message: 'Venue not found' });
    }
    res.status(200).json({ success: true, data: venue, message: 'Venue updated successfully' });
  } catch (error: unknown) {
    const duplicateName = hasErrorCode(error, 11000);
    const statusCode = duplicateName ? 409 : getErrorStatusCode(error, 400);
    res.status(statusCode).json({
      success: false,
      message: duplicateName
        ? 'Venue name already exists'
        : getErrorMessage(error, 'Failed to update venue'),
      ...(error instanceof VenueMutationError ? { code: error.code } : {}),
    });
  }
};

export const deleteVenue = async (req: Request, res: Response) => {
  try {
    const venue = await deleteVenueSafely(req.params.id as string);
    if (!venue) {
      return res.status(404).json({ success: false, message: 'Venue not found' });
    }
    res.status(200).json({ success: true, message: 'Venue deleted successfully' });
  } catch (error: unknown) {
    res.status(getErrorStatusCode(error, 400)).json({
      success: false,
      message: getErrorMessage(error, 'Failed to delete venue'),
      ...(error instanceof VenueMutationError ? { code: error.code } : {}),
    });
  }
};
