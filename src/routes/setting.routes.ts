import { Router } from 'express';
import * as settingController from '@/controllers/setting.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { uploadPublicityImage, uploadSponsorImage } from '@/middleware/image-upload.middleware';

const router = Router();

// Public route to get all settings key-values
router.get('/', settingController.getSettings);

// Protected routes (Admin only)
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.put('/', settingController.updateSettings);

// Protected route to upload images directly to cloudinary
router.post('/upload-logo', uploadSponsorImage, settingController.handleUploadSponsorLogo);
router.post('/upload-publicity', uploadPublicityImage, settingController.handleUploadPublicityBanner);

export default router;
