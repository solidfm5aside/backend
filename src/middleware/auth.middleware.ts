import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '@/utils/jwt.util';
import Admin, { IAdmin } from '@/models/admin.model';
import logger from '@/utils/logger';
import { ACCESS_COOKIE_NAME, readCookie } from '@/utils/auth-cookie.util';

export interface AuthRequest extends Request {
  user?: IAdmin;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    token ||= readCookie(req, ACCESS_COOKIE_NAME);

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    const decoded = verifyAccessToken(token) as {
      id: string;
      iat?: number;
      sessionVersion?: number;
    };
    const admin = await Admin.findById(decoded.id).select('-password');

    if (
      !admin ||
      admin.isDeleted ||
      !admin.isVerified ||
      (decoded.sessionVersion ?? 0) !== (admin.sessionVersion ?? 0)
    ) {
      return res.status(401).json({ success: false, message: 'Not authorized, user not found or deleted' });
    }

    if (
      admin.passwordChangedAt &&
      decoded.iat &&
      Math.floor(admin.passwordChangedAt.getTime() / 1_000) > decoded.iat
    ) {
      return res.status(401).json({ success: false, message: 'Session expired after password change' });
    }

    req.user = admin;
    next();
  } catch (error) {
    logger.error('Auth Middleware Error:', error);
    res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};

export const restrictTo = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to perform this action',
      });
    }
    next();
  };
};
