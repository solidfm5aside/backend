import { Router } from 'express';
import * as authController from '@/controllers/auth.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import Admin, { AdminRole } from '@/models/admin.model';

const router = Router();

router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);

// Administrative routes
router.get('/', protect, restrictTo(AdminRole.SUPER_ADMIN, AdminRole.ADMIN), authController.getAdmins);
router.patch('/verify/:id', protect, restrictTo(AdminRole.SUPER_ADMIN, AdminRole.ADMIN), authController.verifyAdmin);

export default router;
