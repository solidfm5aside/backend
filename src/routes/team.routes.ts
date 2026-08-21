import { Router } from 'express';
import * as teamController from '@/controllers/team.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate, validateObjectIdParam } from '@/middleware/validate.middleware';
import { uploadTeamLogo } from '@/middleware/image-upload.middleware';
import { createTeamSchema, updateTeamSchema, registerTeamSchema } from '@/validators/team.validator';

const router = Router();

// Private projections contain registration contacts and must be declared before /:id.
router.get('/admin', protect, restrictTo('admin', 'super_admin'), teamController.getTeams);
router.get('/admin/:id', protect, restrictTo('admin', 'super_admin'), validateObjectIdParam('id', 'team'), teamController.getTeam);

// Public projections intentionally omit contact details and inactive registrations.
router.get('/', teamController.getPublicTeams);
router.get('/:id', validateObjectIdParam('id', 'team'), teamController.getPublicTeam);
router.post('/register', uploadTeamLogo, validate(registerTeamSchema), teamController.registerTeam);

// Protected routes (Admin only)
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.post('/', uploadTeamLogo, validate(createTeamSchema), teamController.createTeam);
router.patch(
  '/:id',
  validateObjectIdParam('id', 'team'),
  uploadTeamLogo,
  validate(updateTeamSchema),
  teamController.updateTeam
);
router.delete('/:id', validateObjectIdParam('id', 'team'), teamController.deleteTeam);

export default router;
