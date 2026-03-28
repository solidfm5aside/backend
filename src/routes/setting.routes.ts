import { Router } from 'express';
import multer from 'multer';
import * as settingController from '@/controllers/setting.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public route to get all settings key-values
router.get('/', settingController.getSettings);

// Protected routes (Admin only)
router.use(protect);
router.use(restrictTo('super_admin'));

router.put('/', settingController.updateSettings);

// Protected route to upload images directly to cloudinary
router.post('/upload-logo', upload.single('logo'), settingController.handleUploadSponsorLogo);

export default router;
