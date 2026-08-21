import { Request, Response } from 'express';
import { Setting } from '@/models/setting.model';
import { uploadPublicityBanner, uploadSponsorLogo } from '@/utils/cloudinary';
import { getErrorMessage } from '@/utils/http-error.util';

export const getSettings = async (req: Request, res: Response) => {
  try {
    const settings = await Setting.find({});
    
    // Convert array of settings into a key-value object map
    const settingsMap = settings.reduce<Record<string, unknown>>((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: settingsMap
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      message: getErrorMessage(error, 'Failed to fetch settings'),
    });
  }
};

export const updateSettings = async (req: Request, res: Response) => {
  try {
    const updates = req.body; // Expects { "landing_faqs": [...], "landing_about": "..." }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    const updatedSettings = [];

    // Update each setting provided in the payload
    for (const [key, value] of Object.entries(updates)) {
      const updated = await Setting.findOneAndUpdate(
        { key },
        { value },
        { new: true, upsert: true } // upsert creates it if it doesn't exist
      );
      updatedSettings.push(updated);
    }

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      data: updatedSettings
    });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      message: getErrorMessage(error, 'Failed to update settings'),
    });
  }
};

export const handleUploadSponsorLogo = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const uploadedLogo = await uploadSponsorLogo(req.file.buffer);

    res.status(200).json({
      success: true,
      message: 'Sponsor logo uploaded successfully',
      data: { url: uploadedLogo.url }
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      message: getErrorMessage(error, 'Failed to upload sponsor logo'),
    });
  }
};

export const handleUploadPublicityBanner = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const uploadedBanner = await uploadPublicityBanner(req.file.buffer);

    res.status(200).json({
      success: true,
      message: 'Publicity banner uploaded successfully',
      data: { url: uploadedBanner.url }
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      message: getErrorMessage(error, 'Failed to upload publicity banner'),
    });
  }
};
