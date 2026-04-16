import { v2 as cloudinary } from 'cloudinary';
import logger from './logger';

// Cloudinary is automatically configured if CLOUDINARY_URL is in process.env
// But we can explicitly call config() to be sure
cloudinary.config();

export const uploadLogo = async (fileBuffer: Buffer, teamName: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'solidfm/team_logos',
        public_id: `logo_${teamName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error || !result) {
          logger.error('Cloudinary Upload Error:', error);
          reject(new Error('Failed to upload team logo to Cloudinary'));
        } else {
          resolve(result.secure_url);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

export const uploadPassportPic = async (fileBuffer: Buffer, playerName: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'solidfm/player_passports',
        public_id: `passport_${playerName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error || !result) {
          logger.error('Cloudinary Passport Upload Error:', error);
          reject(new Error('Failed to upload player passport to Cloudinary'));
        } else {
          resolve(result.secure_url);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

export const uploadSponsorLogo = async (fileBuffer: Buffer): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'solidfm/sponsors',
        public_id: `sponsor_logo_${Date.now()}`,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error || !result) {
          logger.error('Cloudinary Sponsor Logo Upload Error:', error);
          reject(new Error('Failed to upload sponsor logo to Cloudinary'));
        } else {
          resolve(result.secure_url);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

export const uploadPublicityBanner = async (fileBuffer: Buffer): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'solidfm/publicity',
        public_id: `ad_banner_${Date.now()}`,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error || !result) {
          logger.error('Cloudinary Publicity Upload Error:', error);
          reject(new Error('Failed to upload publicity banner to Cloudinary'));
        } else {
          resolve(result.secure_url);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

export default cloudinary;
