const express = require('express');
const router = express.Router();
const couponWhatsappController = require('../controllers/couponWhatsappController');
const { validate } = require('../middleware/validation');
const { z } = require('zod');

const sendCouponSchema = z.object({
  body: z.object({
    phone: z.string().min(1, 'Phone number is required'),
    from: z.string().optional(),
  }),
});

const sendCouponsToCampaignContactSchema = z.object({
  body: z.object({
    couponIds: z.array(z.string()).min(1, 'At least one coupon ID is required'),
    from: z.string().optional(),
  }),
});

const generateAndSendCouponSchema = z.object({
  body: z.object({
    phone: z.string().min(1, 'Phone number is required'),
    prospectName: z.string().min(1, 'Prospect name is required'),
    businessName: z.string().min(1, 'Business name is required'),
    scenario: z.string().optional(),
    agentId: z.string().min(1, 'Agent ID is required'),
    callId: z.string().min(1, 'Call ID is required'),
    campaignId: z.string().optional(),
    campaignContactId: z.string().optional(),
    couponType: z.string().optional(),
    from: z.string().optional(),
  }),
});

const resendCouponSchema = z.object({
  body: z.object({
    phone: z.string().min(1, 'Phone number is required'),
    from: z.string().optional(),
  }),
});

// Send existing coupon via WhatsApp
router.post('/:couponId/send', validate(sendCouponSchema), couponWhatsappController.sendCoupon);

// Send multiple coupons to campaign contact
router.post(
  '/campaign-contact/:campaignContactId/send-coupons',
  validate(sendCouponsToCampaignContactSchema),
  couponWhatsappController.sendCouponsToCampaignContact
);

// Generate and send coupon in one operation
router.post(
  '/generate-and-send',
  validate(generateAndSendCouponSchema),
  couponWhatsappController.generateAndSendCoupon
);

// Resend existing coupon
router.post(
  '/:couponId/resend',
  validate(resendCouponSchema),
  couponWhatsappController.resendCoupon
);

module.exports = router;
