const express = require("express");
const router = express.Router();
const campaignsController = require("../controllers/campaignsController");
const { authenticateJWT } = require("../middleware/auth");
const { validate } = require("../middleware/validation");
const { z } = require("zod");

const createCampaignSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Nombre de campaña requerido"),
    description: z.string().optional(),
    type: z.string().optional(),
    centerLat: z.number().optional(),
    centerLng: z.number().optional(),
    radiusMeters: z.number().int().positive().optional(),
    activityCodes: z.array(z.string()).optional(),
    employeeRanges: z.array(z.string()).optional(),
    filters: z.record(z.any()).nullable(),
    agentConfigId: z.string().optional(),
    agentConfigName: z.string().optional(),
    offer: z.string().optional(),
    couponPrefix: z.string().optional(),
  }),
});

const updateCampaignSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]).optional(),
    centerLat: z.number().optional(),
    centerLng: z.number().optional(),
    radiusMeters: z.number().int().positive().optional(),
    filters: z.record(z.any()).optional(),
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

const updateContactStatusSchema = z.object({
  body: z.object({
    status: z.enum(["PENDING", "SENT", "DELIVERED", "VISITED", "CONVERTED", "FAILED"]),
    messageId: z.string().optional(),
    errorReason: z.string().optional(),
  }),
});

// router.use(authenticateJWT);

router.post("/", validate(createCampaignSchema), campaignsController.create);
router.get("/", campaignsController.list);
router.get("/:id", campaignsController.getById);
router.patch("/:id", validate(updateCampaignSchema), campaignsController.update);
router.delete("/:id", campaignsController.delete);

router.post("/:id/contacts", validate(assignContactsSchema), campaignsController.assignContacts);
router.post("/:id/contacts/geo", validate(assignContactsGeoSchema), campaignsController.assignContactsWithGeo);
router.get("/:id/contacts", campaignsController.getContacts);
router.patch("/contacts/:contactId/status", validate(updateContactStatusSchema), campaignsController.updateContactStatus);

router.get("/:id/stats", campaignsController.getStats);

module.exports = router;
