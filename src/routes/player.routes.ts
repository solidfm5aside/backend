import { Router } from 'express';
import * as playerController from '@/controllers/player.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate } from '@/middleware/validate.middleware';
import { createPlayerSchema, updatePlayerSchema } from '@/validators/player.validator';

import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public routes
router.get('/', playerController.getPlayers);
router.get('/:id', playerController.getPlayer);

// Protected routes (Admin only)
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.post('/', upload.single('passportPic'), validate(createPlayerSchema), playerController.createPlayer);
router.patch('/:id', validate(updatePlayerSchema), playerController.updatePlayer);
router.delete('/:id', playerController.deletePlayer);

export default router;
