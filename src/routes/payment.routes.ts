import { Router } from 'express';
import * as paymentController from '@/controllers/payment.controller';
import { protect, restrictTo } from '@/middleware/auth.middleware';
import { validate } from '@/middleware/validate.middleware';
import { createPaymentSchema } from '@/validators/payment.validator';

const router = Router();

// Only Admins can manage payments for now
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

router.post('/', validate(createPaymentSchema), paymentController.recordPayment);
router.get('/', paymentController.getPayments);
router.patch('/:id/status', paymentController.updateStatus);

export default router;
