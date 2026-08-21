import { Router } from 'express';
import * as authController from '@/controllers/auth.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { AdminRole } from '@/models/admin.model';
import { validate, validateObjectIdParam } from '@/middleware/validate.middleware';
import { adminRoleUpdateSchema } from '@/validators/auth.validator';

const router = Router();

router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);
router.post('/forgot-password', authController.forgotPassword);
router.patch('/reset-password/:token', authController.resetPassword);
router.get('/me', protect, authController.getMe);

// Administrative routes
router.get('/', protect, restrictTo(AdminRole.SUPER_ADMIN), authController.getAdmins);
router.patch(
  '/admins/:id/role',
  protect,
  restrictTo(AdminRole.SUPER_ADMIN),
  validateObjectIdParam('id', 'administrator'),
  validate(adminRoleUpdateSchema),
  authController.updateAdminRole
);
router.patch(
  '/verify/:id',
  protect,
  restrictTo(AdminRole.SUPER_ADMIN),
  validateObjectIdParam('id', 'administrator'),
  authController.verifyAdmin
);

export default router;
