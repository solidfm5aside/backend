import { Router } from 'express';
import * as teamController from '@/controllers/team.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate } from '@/middleware/validate.middleware';
import { createTeamSchema, updateTeamSchema, registerTeamSchema } from '@/validators/team.validator';

import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public routes (if any, e.g., get all teams for public view)
router.get('/', teamController.getTeams);
router.get('/:id', teamController.getTeam);
router.post('/register', upload.single('logo'), validate(registerTeamSchema), teamController.registerTeam);

// Protected routes (Admin only)
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.post('/', validate(createTeamSchema), teamController.createTeam);
router.patch('/:id', validate(updateTeamSchema), teamController.updateTeam);
router.delete('/:id', teamController.deleteTeam);

export default router;
