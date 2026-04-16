import { Request, Response } from 'express';
import { Setting } from '@/models/setting.model';

export const getSettings = async (req: Request, res: Response) => {
  try {
    const settings = await Setting.find({});
    
    // Convert array of settings into a key-value object map
    const settingsMap = settings.reduce((acc: any, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: settingsMap
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
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
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

import { uploadSponsorLogo, uploadPublicityBanner } from '@/utils/cloudinary';

export const handleUploadSponsorLogo = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const logoUrl = await uploadSponsorLogo(req.file.buffer);

    res.status(200).json({
      success: true,
      message: 'Sponsor logo uploaded successfully',
      data: { url: logoUrl }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const handleUploadPublicityBanner = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const bannerUrl = await uploadPublicityBanner(req.file.buffer);

    res.status(200).json({
      success: true,
      message: 'Publicity banner uploaded successfully',
      data: { url: bannerUrl }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
