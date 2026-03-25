const express = require("express");
const router = express.Router();
const couponCallController = require("../controllers/couponCallController");
const { validate } = require("../middleware/validation");
const { z } = require("zod");

const generateForCallSchema = z.object({
  body: z.object({
    phone: z.string().min(1, "Phone number is required"),
    prospectName: z.string().min(1, "Prospect name is required"),
    businessName: z.string().min(1, "Business name is required"),
    scenario: z.string().min(1, "Scenario is required"),
    agentId: z.string().min(1, "Agent ID is required"),
    callId: z.string().min(1, "Call ID is required"),
    campaignId: z.string().optional(),
    campaignContactId: z.string().optional(),
    couponType: z.string().optional(),
    from: z.string().optional()
  })
});

/**
 * POST /api/v1/coupons/generate-for-call
 * Webhook para que ElevenLabs genere y envíe un cupón durante una llamada
 * NOTA: Este endpoint es público (sin autenticación) para que ElevenLabs pueda llamarlo
 */
router.post("/generate-for-call", validate(generateForCallSchema), couponCallController.generateForCall);

module.exports = router;
