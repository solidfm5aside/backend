import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '@/utils/jwt.util';
import Admin, { IAdmin } from '@/models/admin.model';
import logger from '@/utils/logger';

export interface AuthRequest extends Request {
  user?: IAdmin;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    const decoded = verifyAccessToken(token) as { id: string };
    const admin = await Admin.findById(decoded.id).select('-password');

    if (!admin || admin.isDeleted) {
      return res.status(401).json({ success: false, message: 'Not authorized, user not found or deleted' });
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
