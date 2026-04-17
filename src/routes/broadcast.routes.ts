import { Router } from 'express';
import { postBroadcast } from '@/controllers/broadcast.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';

const router = Router();

/**
 * All broadcast routes are protected for admins and super admins only.
 */
router.post('/', protect, restrictTo('admin', 'super_admin'), postBroadcast);

export default router;
