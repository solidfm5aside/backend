import { v2 as cloudinary } from 'cloudinary';
import logger from './logger';

// Cloudinary is automatically configured if CLOUDINARY_URL is in process.env
// But we can explicitly call config() to be sure
cloudinary.config();

export interface UploadedImage {
  url: string;
  publicId: string;
}

export const uploadLogo = async (fileBuffer: Buffer, teamName: string): Promise<UploadedImage> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'solidfm/team_logos',
        public_id: `logo_${teamName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) {
          logger.error('Cloudinary Upload Error:', error);
          reject(new Error('Failed to upload team logo to Cloudinary'));
        } else {
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

export const uploadPassportPic = async (
  fileBuffer: Buffer,
  playerName: string
): Promise<UploadedImage> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'solidfm/player_passports',
        public_id: `passport_${playerName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) {
          logger.error('Cloudinary Passport Upload Error:', error);
          reject(new Error('Failed to upload player passport to Cloudinary'));
        } else {
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

export const uploadSponsorLogo = async (fileBuffer: Buffer): Promise<UploadedImage> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'solidfm/sponsors',
        public_id: `sponsor_logo_${Date.now()}`,
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) {
          logger.error('Cloudinary Sponsor Logo Upload Error:', error);
          reject(new Error('Failed to upload sponsor logo to Cloudinary'));
        } else {
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

export const uploadPublicityBanner = async (fileBuffer: Buffer): Promise<UploadedImage> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'solidfm/publicity',
        public_id: `ad_banner_${Date.now()}`,
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) {
          logger.error('Cloudinary Publicity Upload Error:', error);
          reject(new Error('Failed to upload publicity banner to Cloudinary'));
        } else {
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

export const deleteUploadedImage = async (publicId: string): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  } catch (error) {
    logger.error(`Failed to clean up Cloudinary image ${publicId}:`, error);
  }
};

export const getManagedCloudinaryPublicId = (imageUrl?: string): string | undefined => {
  if (!imageUrl) return undefined;

  try {
    const url = new URL(imageUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'res.cloudinary.com') {
      return undefined;
    }

    const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    const configuredCloudName = process.env.CLOUDINARY_CLOUD_NAME || cloudinary.config().cloud_name;
    if (
      !configuredCloudName ||
      segments[0] !== configuredCloudName ||
      segments[1] !== 'image' ||
      segments[2] !== 'upload'
    ) {
      return undefined;
    }

    const solidFmFolderIndex = segments.indexOf('solidfm', 3);
    if (solidFmFolderIndex === -1 || solidFmFolderIndex === segments.length - 1) {
      return undefined;
    }

    const publicIdSegments = segments.slice(solidFmFolderIndex);
    const filename = publicIdSegments.at(-1);
    if (!filename) return undefined;
    publicIdSegments[publicIdSegments.length - 1] = filename.replace(/\.[a-zA-Z0-9]+$/, '');
    return publicIdSegments.join('/');
  } catch {
    return undefined;
  }
};

export default cloudinary;
