import { NextFunction, Request, Response } from 'express';
import multer from 'multer';

const MEBIBYTE = 1024 * 1024;

export const IMAGE_UPLOAD_LIMITS = {
  teamLogo: 1 * MEBIBYTE,
  playerPhoto: 1 * MEBIBYTE,
  sponsorLogo: 2 * MEBIBYTE,
  publicityBanner: 5 * MEBIBYTE,
} as const;

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const hasBytes = (buffer: Buffer, offset: number, bytes: number[]): boolean =>
  bytes.every((byte, index) => buffer[offset + index] === byte);

const hasValidImageSignature = (buffer: Buffer, mimeType: string): boolean => {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && hasBytes(buffer, 0, [0xff, 0xd8, 0xff]);
  }

  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      hasBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }

  if (mimeType === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }

  return false;
};

class UnsupportedImageTypeError extends Error {
  constructor() {
    super('Only JPEG, PNG, and WebP images are allowed');
    this.name = 'UnsupportedImageTypeError';
  }
}

const createImageUpload = (fieldName: string, maxFileSize: number) => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSize,
      files: 1,
      fields: 20,
      parts: 21,
    },
    fileFilter: (_req, file, callback) => {
      if (!ALLOWED_IMAGE_TYPES.has(file.mimetype.toLowerCase())) {
        callback(new UnsupportedImageTypeError());
        return;
      }

      callback(null, true);
    },
  }).single(fieldName);

  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        const isTooLarge = error.code === 'LIMIT_FILE_SIZE';
        return res.status(isTooLarge ? 413 : 400).json({
          success: false,
          message: isTooLarge
            ? `Image must not exceed ${Math.floor(maxFileSize / MEBIBYTE)}MB`
            : error.message,
        });
      }

      if (error instanceof UnsupportedImageTypeError) {
        return res.status(400).json({ success: false, message: error.message });
      }

      if (error) {
        return next(error);
      }

      if (req.file && !hasValidImageSignature(req.file.buffer, req.file.mimetype.toLowerCase())) {
        req.file = undefined;
        return res.status(400).json({
          success: false,
          message: 'The uploaded file content does not match a supported image type',
        });
      }

      next();
    });
  };
};

export const uploadTeamLogo = createImageUpload('logo', IMAGE_UPLOAD_LIMITS.teamLogo);
export const uploadPlayerPhoto = createImageUpload('passportPic', IMAGE_UPLOAD_LIMITS.playerPhoto);
export const uploadSponsorImage = createImageUpload('logo', IMAGE_UPLOAD_LIMITS.sponsorLogo);
export const uploadPublicityImage = createImageUpload('image', IMAGE_UPLOAD_LIMITS.publicityBanner);
