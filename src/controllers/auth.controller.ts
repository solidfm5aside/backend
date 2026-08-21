import { Request, Response } from 'express';
import type { AuthRequest } from '@/middleware/auth.middleware';
import Admin, { AdminRole } from '@/models/admin.model';
import {
  AdminRegistrationError,
  registerAdmin,
} from '@/services/auth-registration.service';
import {
  AdminAccessError,
  changeAdminRole,
} from '@/services/admin-access.service';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '@/utils/jwt.util';
import logger from '@/utils/logger';
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from '@/validators/auth.validator';
import crypto from 'crypto';
import { ZodError } from 'zod';
import { sendEmail } from '@/utils/mailer';
import { getPasswordResetTemplate } from '@/utils/email-templates';
import { ADMIN_BOOTSTRAP_HEADER } from '@/utils/admin-bootstrap.util';
import { getFrontendOrigin } from '@/utils/client-origin.util';
import {
  clearAuthCookies,
  readCookie,
  REFRESH_COOKIE_NAME,
  setAuthCookies,
} from '@/utils/auth-cookie.util';
import { getErrorMessage } from '@/utils/http-error.util';

export const register = async (req: Request, res: Response) => {
  try {
    const validatedData = registerSchema.parse(req.body);
    const headerSecret = req.get(ADMIN_BOOTSTRAP_HEADER);
    if (
      headerSecret &&
      validatedData.bootstrapSecret &&
      headerSecret !== validatedData.bootstrapSecret
    ) {
      return res.status(400).json({
        success: false,
        code: 'ADMIN_BOOTSTRAP_SECRET_CONFLICT',
        message: 'Bootstrap secret header and body values do not match',
      });
    }
    const { bootstrapSecret, ...registration } = validatedData;
    const { admin, isFirstAdmin } = await registerAdmin(
      registration,
      headerSecret ?? bootstrapSecret
    );
    
    res.status(201).json({
      success: true,
      message: isFirstAdmin 
        ? 'Super Admin registered successfully' 
        : 'Admin registered successfully. Please wait for verification.',
      data: { id: admin._id, name: admin.name, email: admin.email, role: admin.role, isVerified: admin.isVerified }
    });
  } catch (error: unknown) {
    logger.error('Registration Error:', error);
    if (error instanceof AdminRegistrationError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        message: error.issues[0]?.message ?? 'Invalid registration details',
      });
    }
    if (
      error &&
      typeof error === 'object' &&
      (error as { code?: number }).code === 11000
    ) {
      return res.status(409).json({
        success: false,
        message: 'An administrator with this email already exists',
      });
    }
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const admin = await Admin.findOne({ email }).select('+password');
    if (!admin || admin.isDeleted || !(await admin.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!admin.isVerified) {
      return res.status(403).json({ success: false, message: 'Your account is pending verification by a Super Admin' });
    }

    const sessionVersion = admin.sessionVersion ?? 0;
    const accessToken = signAccessToken({ id: admin._id, sessionVersion });
    const refreshToken = signRefreshToken({ id: admin._id, sessionVersion });

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();
    setAuthCookies(res, accessToken, refreshToken);

    res.status(200).json({
      success: true,
      data: {
        admin: {
          _id: admin._id,
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          isVerified: admin.isVerified,
        }
      }
    });
  } catch (error: unknown) {
    logger.error('Login Error:', error);
    res.status(400).json({ success: false, message: getErrorMessage(error, 'Login failed') });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const token = readCookie(req, REFRESH_COOKIE_NAME);
    if (!token) return res.status(401).json({ success: false, message: 'Refresh token required' });

    const decoded = verifyRefreshToken(token) as {
      id: string;
      iat?: number;
      sessionVersion?: number;
    };
    const admin = await Admin.findById(decoded.id);

    if (
      !admin ||
      admin.isDeleted ||
      !admin.isVerified ||
      (decoded.sessionVersion ?? 0) !== (admin.sessionVersion ?? 0)
    ) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const issuedAt = decoded.iat;
    if (
      admin.passwordChangedAt &&
      issuedAt &&
      Math.floor(admin.passwordChangedAt.getTime() / 1_000) > issuedAt
    ) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const sessionVersion = admin.sessionVersion ?? 0;
    const newAccessToken = signAccessToken({ id: admin._id, sessionVersion });
    const newRefreshToken = signRefreshToken({ id: admin._id, sessionVersion });
    setAuthCookies(res, newAccessToken, newRefreshToken);

    res.status(200).json({
      success: true,
      data: { refreshed: true }
    });
  } catch (error) {
    logger.error('Refresh Token Error:', error);
    res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
};


const sendAdminAccessError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof AdminAccessError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  logger.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
};

export const verifyAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const admin = await changeAdminRole(
      req.user!._id.toString(),
      req.params.id as string,
      AdminRole.ADMIN
    );

    res.status(200).json({
      success: true,
      message: `${admin.name} has been verified as an Admin`,
      data: { id: admin._id, name: admin.name, role: admin.role, isVerified: admin.isVerified }
    });
  } catch (error: unknown) {
    sendAdminAccessError(res, error, 'Failed to verify administrator');
  }
};

export const updateAdminRole = async (req: AuthRequest, res: Response) => {
  try {
    const admin = await changeAdminRole(
      req.user!._id.toString(),
      req.params.id as string,
      req.body.role as AdminRole
    );

    res.status(200).json({
      success: true,
      message: `${admin.name} now has the ${admin.role.replace('_', ' ')} role`,
      data: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        isVerified: admin.isVerified,
        lastLogin: admin.lastLogin,
      },
    });
  } catch (error: unknown) {
    sendAdminAccessError(res, error, 'Failed to update administrator access');
  }
};

export const logout = async (req: Request, res: Response) => {
  const token = readCookie(req, REFRESH_COOKIE_NAME);
  if (token) {
    let decoded: { id: string; sessionVersion?: number } | undefined;
    try {
      decoded = verifyRefreshToken(token) as { id: string; sessionVersion?: number };
    } catch {
      // An invalid or expired cookie has no live server session to revoke.
    }

    if (decoded) {
      const decodedVersion = decoded.sessionVersion ?? 0;
      try {
        const result = await Admin.updateOne(
          {
            _id: decoded.id,
            ...(decodedVersion === 0
              ? { $or: [{ sessionVersion: 0 }, { sessionVersion: { $exists: false } }] }
              : { sessionVersion: decodedVersion }),
          },
          { $inc: { sessionVersion: 1 } }
        );

        if (!result.acknowledged || (result.matchedCount === 1 && result.modifiedCount !== 1)) {
          throw new Error('The current admin session version was not incremented');
        }
        // A validly signed but stale token matches no current session and is
        // already revoked, so local cookie clearing is sufficient.
      } catch (error) {
        logger.error('Logout session revocation failed:', error);
        clearAuthCookies(res);
        return res.status(503).json({
          success: false,
          code: 'SESSION_REVOCATION_FAILED',
          message: 'Logout could not revoke the server session. This device was signed out locally.',
        });
      }
    }
  }
  clearAuthCookies(res);
  res.status(200).json({ success: true, message: 'Logged out successfully' });
};

export const getMe = async (req: AuthRequest, res: Response) => {
  const admin = req.user!;
  res.status(200).json({
    success: true,
    data: {
      _id: admin._id,
      id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isVerified: admin.isVerified,
    },
  });
};

export const getAdmins = async (req: Request, res: Response) => {
  try {
    const admins = await Admin.find({ isDeleted: false })
      .select('name email role isVerified lastLogin createdAt')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: admins });
  } catch (error) {
    logger.error('Get Admins Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch admins' });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const admin = await Admin.findOne({ email });

    if (!admin || admin.isDeleted) {
      // For security, don't reveal that the user does not exist
      return res.status(200).json({ 
        success: true, 
        message: 'If an account exists with that email, a reset link has been sent.' 
      });
    }

    const resetToken = admin.createPasswordResetToken();
    await admin.save({ validateBeforeSave: false });

    // Construct reset URL
    const frontendUrl = getFrontendOrigin();
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    // Send the actual email
    try {
      const html = getPasswordResetTemplate(admin.name, resetUrl);
      await sendEmail(
        [admin.email],
        'Reset Your Password - SolidFM',
        `Please reset your password using this link: ${resetUrl}`,
        html
      );
      logger.info(`Password reset email sent to ${admin.email}`);
    } catch (emailError) {
      logger.error('Failed to send reset email:', emailError);
      // We don't throw here to avoid revealing account existence, 
      // but we've already logged the error.
    }

    res.status(200).json({
      success: true,
      message: 'If an account exists with that email, a reset link has been sent.'
    });
  } catch (error: unknown) {
    logger.error('Forgot Password Error:', error);
    res.status(400).json({
      success: false,
      message: getErrorMessage(error, 'Error processing request'),
    });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { password } = resetPasswordSchema.parse(req.body);

    const hashedToken = crypto.createHash('sha256').update(token as string).digest('hex');

    const admin = await Admin.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    }).select('+password');

    if (!admin) {
      return res.status(400).json({ success: false, message: 'Token is invalid or has expired' });
    }

    admin.password = password;
    admin.passwordResetToken = undefined;
    admin.passwordResetExpires = undefined;
    admin.passwordChangedAt = new Date();
    admin.sessionVersion = (admin.sessionVersion ?? 0) + 1;
    await admin.save();

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now log in.'
    });
  } catch (error: unknown) {
    logger.error('Reset Password Error:', error);
    res.status(400).json({
      success: false,
      message: getErrorMessage(error, 'Error resetting password'),
    });
  }
};
