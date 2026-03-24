import { Router } from 'express';
import * as dashboardController from '@/controllers/dashboard.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';

const router = Router();

router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.get('/stats', dashboardController.getDashboardStats);

export default router;
