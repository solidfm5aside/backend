import { Router } from 'express';
import * as playerController from '@/controllers/player.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate, validateObjectIdParam } from '@/middleware/validate.middleware';
import { uploadPlayerPhoto } from '@/middleware/image-upload.middleware';
import { createPlayerSchema, updatePlayerSchema } from '@/validators/player.validator';

const router = Router();

// Private projections include the uploaded player photo field.
router.get('/admin', protect, restrictTo('admin', 'super_admin'), playerController.getPlayers);
router.get('/admin/:id', protect, restrictTo('admin', 'super_admin'), validateObjectIdParam('id', 'player'), playerController.getPlayer);

// Public projections intentionally omit passport-photo data.
router.get('/', playerController.getPublicPlayers);
router.get('/:id', validateObjectIdParam('id', 'player'), playerController.getPublicPlayer);

// Protected routes (Admin only)
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.post('/', uploadPlayerPhoto, validate(createPlayerSchema), playerController.createPlayer);
router.patch(
  '/:id',
  validateObjectIdParam('id', 'player'),
  uploadPlayerPhoto,
  validate(updatePlayerSchema),
  playerController.updatePlayer
);
router.delete('/:id', validateObjectIdParam('id', 'player'), playerController.deletePlayer);

export default router;
