const express = require("express");
const router = express.Router();
const campaignsController = require("../controllers/campaignsController");
const campaignWebhookController = require("../controllers/campaignWebhookController");
const { authenticateJWT } = require("../middleware/auth");
const { validate } = require("../middleware/validation");
const { z } = require("zod");

const createCampaignSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Nombre de campaña requerido"),
    description: z.string().optional(),
    type: z.enum(["DISCOVERY", "ACTIVATION", "QUALIFICATION", "CONVERSION"]).optional(),
    centerLat: z.number().nullable().optional(),
    centerLng: z.number().nullable().optional(),
    radiusMeters: z.number().int().positive().nullable().optional(),
    activityCodes: z.array(z.string()).optional(),
    employeeRanges: z.array(z.string()).optional(),
    filters: z.record(z.any()).nullable().optional(),
    agentConfigId: z.string().min(1, "Agente es requerido"),
    agentConfigName: z.string().optional(),
    offer: z.string().nullable().optional(),
    couponPrefix: z.string().nullable().optional(),
    couponTemplateIds: z.array(z.string()).optional(),
    // Reenganche: lista pre-armada de IDs (omite filtro geo)
    establishmentIds: z.array(z.string()).max(500, "Máximo 500 establecimientos por dispatch").optional(),
    sourceCampaignId: z.string().optional(),
  }),
});

const updateCampaignSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    type: z.string().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "SCHEDULED"]).optional(),
    centerLat: z.number().optional(),
    centerLng: z.number().optional(),
    radiusMeters: z.number().int().positive().optional(),
    activityCodes: z.array(z.string()).optional(),
    employeeRanges: z.array(z.string()).optional(),
    filters: z.record(z.any()).optional(),
    agentConfigId: z.string().optional(),
    agentConfigName: z.string().optional(),
    offer: z.string().nullable().optional(),
    couponPrefix: z.string().nullable().optional(),
    couponTemplateIds: z.array(z.string()).optional(),
    scheduledAt: z.string().optional(),
  }),
});

const assignContactsSchema = z.object({
  body: z.object({
    establishmentIds: z.array(z.string()).min(1, "Al menos un establishmentId es requerido"),
  }),
});

const assignContactsGeoSchema = z.object({
  body: z.object({
    filters: z.record(z.any()).optional(),
  }),
});

const startCampaignSchema = z.object({
  body: z.object({
    agentId: z.string().min(1).optional(),
    targetConcurrencyLimit: z.number().int().positive().optional(),
    maxRecipientsPerRequest: z.number().int().positive().optional(),
    scheduledTimeUnix: z.number().int().positive().optional(),
    agentPhoneNumberId: z.string().min(1).optional(),
  }).optional().default({}),
});

const updateContactStatusSchema = z.object({
  body: z.object({
    status: z.enum(["PENDING", "CALLING", "PAUSED", "CALLED", "RESPONDED", "SENT", "DELIVERED", "VISITED", "CONVERTED", "FAILED"]),
    messageId: z.string().optional(),
    errorReason: z.string().optional(),
  }),
});

const loadCouponTemplatesSchema = z.object({
  body: z.object({
    couponTemplateIds: z.array(z.string()).min(1, "At least one coupon template ID is required"),
  }),
});

router.post("/elevenlabs-webhook", campaignWebhookController.handleElevenLabsWebhook);

// router.use(authenticateJWT);

router.post("/", validate(createCampaignSchema), campaignsController.create);
router.get("/", campaignsController.list);
router.get("/agents", campaignsController.getAgents);
router.get('/eligible-count', campaignsController.getEligibleCount);
// Ruta antes de /:id para evitar colisión de matching
router.get('/reengagement-candidates', campaignsController.getReengagementCandidates);
router.get("/:id", campaignsController.getById);
router.patch("/:id", validate(updateCampaignSchema), campaignsController.update);
router.delete("/:id", campaignsController.delete);

router.post("/:id/contacts", validate(assignContactsSchema), campaignsController.assignContacts);
router.post("/:id/contacts/geo", validate(assignContactsGeoSchema), campaignsController.assignContactsWithGeo);
router.post("/:id/start", validate(startCampaignSchema), campaignsController.startCampaign);
router.post("/:id/pause", campaignsController.pauseCampaign);
router.post("/:id/resume", campaignsController.resumeCampaign);
router.post("/:id/cancel", campaignsController.cancel);
router.post("/:id/retry", campaignsController.retry);
router.get("/:id/contacts", campaignsController.getContacts);
router.patch("/contacts/:contactId/status", validate(updateContactStatusSchema), campaignsController.updateContactStatus);

router.get("/:id/stats", campaignsController.getStats);
router.get("/:id/coupon-breakdown", campaignsController.getCouponBreakdown);

router.post("/:id/load-coupon-templates", validate(loadCouponTemplatesSchema), campaignsController.loadCouponTemplates);
router.get("/:id/send-preview", campaignsController.getCampaignSendPreview);
router.get("/:id/validate-before-start", campaignsController.validateBeforeStart);

module.exports = router;
