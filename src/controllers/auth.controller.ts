import { Request, Response, NextFunction } from 'express';
import Admin, { AdminRole } from '@/models/admin.model';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '@/utils/jwt.util';
import logger from '@/utils/logger';
import { loginSchema, registerSchema } from '@/validators/auth.validator';

export const register = async (req: Request, res: Response) => {
  try {
    const validatedData = registerSchema.parse(req.body);

    // Check if any admin exists
    const adminCount = await Admin.countDocuments();
    
    const isFirstAdmin = adminCount === 0;

    const admin = await Admin.create({
      ...validatedData,
      role: isFirstAdmin ? AdminRole.SUPER_ADMIN : AdminRole.VIEWER,
      isVerified: isFirstAdmin,
    });
    
    res.status(201).json({
      success: true,
      message: isFirstAdmin 
        ? 'Super Admin registered successfully' 
        : 'Admin registered successfully. Please wait for verification.',
      data: { id: admin._id, name: admin.name, email: admin.email, role: admin.role, isVerified: admin.isVerified }
    });
  } catch (error: any) {
    logger.error('Registration Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Registration failed' });
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

    const accessToken = signAccessToken({ id: admin._id, role: admin.role });
    const refreshToken = signRefreshToken({ id: admin._id });

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    res.status(200).json({
      success: true,
      data: {
        admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role },
        accessToken,
        refreshToken
      }
    });
  } catch (error: any) {
    logger.error('Login Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Login failed' });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(401).json({ success: false, message: 'Refresh token required' });

    const decoded = verifyRefreshToken(token) as { id: string };
    const admin = await Admin.findById(decoded.id);

    if (!admin || admin.isDeleted) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const newAccessToken = signAccessToken({ id: admin._id, role: admin.role });
    const newRefreshToken = signRefreshToken({ id: admin._id }); // Rotation

    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    logger.error('Refresh Token Error:', error);
    res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
};


export const verifyAdmin = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const admin = await Admin.findById(id);

    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    admin.isVerified = true;
    // Upgrade to ADMIN if they were VIEWER
    if (admin.role === AdminRole.VIEWER) {
      admin.role = AdminRole.ADMIN;
    }
    await admin.save();

    res.status(200).json({
      success: true,
      message: `${admin.name} has been verified as an Admin`,
      data: { id: admin._id, name: admin.name, role: admin.role, isVerified: admin.isVerified }
    });
  } catch (error) {
    logger.error('Verify Admin Error:', error);
    res.status(400).json({ success: false, message: 'Verification failed' });
  }
};

export const logout = async (req: Request, res: Response) => {
  // In a stateless JWT system, logout is mostly handled on the client by deleting the token.
  // We can implement a blacklist if needed, but for now, simple success response.
  res.status(200).json({ success: true, message: 'Logged out successfully' });
};

export const getAdmins = async (req: Request, res: Response) => {
  try {
    const admins = await Admin.find({ isDeleted: false }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: admins });
  } catch (error) {
    logger.error('Get Admins Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch admins' });
  }
};
