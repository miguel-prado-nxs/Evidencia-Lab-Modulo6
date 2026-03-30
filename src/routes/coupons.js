const express = require("express");
const router = express.Router();
const couponsController = require("../controllers/couponsController");
const { authenticateJWT, authenticateApiKey } = require("../middleware/auth");
const { validate } = require("../middleware/validation");
const { z } = require("zod");

const createCouponSchema = z.object({
  body: z.object({
    campaignId: z.string().min(1, "campaignId es requerido"),
    code: z.string().optional(),
    offer: z.string().min(1, "offer es requerido"),
  }),
});

const generateBulkSchema = z.object({
  body: z.object({
    campaignId: z.string().min(1, "campaignId es requerido"),
    count: z.number().int().min(1).max(1000),
    offerTemplate: z.string().min(1, "offerTemplate es requerido"),
  }),
});

const trackVisitSchema = z.object({
  body: z.object({
    metadata: z.record(z.any()).optional(),
  }),
});

const markConvertedSchema = z.object({
  body: z.object({
    conversionData: z.record(z.any()).optional(),
  }),
});

const assignToContactSchema = z.object({
  body: z.object({
    contactId: z.string().min(1, "contactId es requerido"),
  }),
});

const campaignContextSchema = z.object({
  campaignId: z.string().optional(),
  campaignContactId: z.string().optional(),
  couponType: z.string().optional(),
}).optional();

const generateForCallSchema = z.object({
  body: z.object({
    phone: z.string().min(1, "phone es requerido"),
    prospectName: z.string().min(1, "prospectName es requerido"),
    businessName: z.string().min(1, "businessName es requerido"),
    scenario: z.string().optional(), // Opcional si viene campaignContext.couponType
    bantScores: z.record(z.any()).optional(),
    agentId: z.string().min(1, "agentId es requerido"),
    callId: z.string().min(1, "callId es requerido"),
    campaignId: z.string().optional(),
    campaignContext: campaignContextSchema, // Contexto opcional de campaña
  }),
});

const redeemCouponSchema = z.object({
  body: z.object({
    userData: z.record(z.any()).optional(),
  }),
});

const checkEligibilitySchema = z.object({
  body: z.object({
    phone: z.string().min(1, "phone es requerido"),
    couponType: z.string().min(1, "couponType es requerido"),
  }),
});

// Rutas públicas con API Key (para landing page y agentes)
router.post("/:code/visit", authenticateApiKey, validate(trackVisitSchema), couponsController.trackVisit);
router.post("/:code/convert", authenticateApiKey, validate(markConvertedSchema), couponsController.markAsConverted);
router.post("/:code/redeem", authenticateApiKey, validate(redeemCouponSchema), couponsController.redeemCoupon);
router.post("/generate-for-call", authenticateApiKey, validate(generateForCallSchema), couponsController.generateForCall);
router.post("/check-eligibility", authenticateApiKey, validate(checkEligibilitySchema), couponsController.checkEligibility);

router.use(authenticateJWT);

router.post("/", validate(createCouponSchema), couponsController.create);
router.post("/bulk", validate(generateBulkSchema), couponsController.generateBulk);
router.get("/", couponsController.list);
router.get("/available", couponsController.getAvailable);
router.get("/active-with-time", couponsController.getActiveWithTimeRemaining);
router.post("/mark-expired", couponsController.markExpired);
router.get("/code/:code", couponsController.getByCode);
router.get("/validate/:code", couponsController.validateForUse);
router.get("/:id", couponsController.getById);
router.get("/:id/stats", couponsController.getStats);
router.post("/:couponId/assign", validate(assignToContactSchema), couponsController.assignToContact);

module.exports = router;
