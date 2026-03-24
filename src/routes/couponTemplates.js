const express = require("express");
const router = express.Router();
const couponTemplatesController = require("../controllers/couponTemplatesController");
const { authenticateJWT } = require("../middleware/auth");
const { validate } = require("../middleware/validation");
const { z } = require("zod");

const createTemplateSchema = z.object({
  body: z.object({
    couponType: z.string().min(1, "couponType es requerido"),
    name: z.string().min(1, "name es requerido"),
    description: z.string().optional(),
    scenarios: z.array(z.string()).optional(),
    percentOff: z.number().int().min(0).max(100).optional(),
    durationMonths: z.number().int().min(1).optional(),
    trialDays: z.number().int().min(1).optional(),
    messageTemplate: z.string().min(1, "messageTemplate es requerido"),
    mediaUrl: z.string().url().optional(),
    maxPerUser: z.number().int().min(1).optional(),
    expiresHours: z.number().int().min(1).optional(),
    validFor: z.array(z.string()).optional(),
    priority: z.number().int().optional(),
  }),
});

const updateTemplateSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    scenarios: z.array(z.string()).optional(),
    percentOff: z.number().int().min(0).max(100).optional(),
    durationMonths: z.number().int().min(1).optional(),
    trialDays: z.number().int().min(1).optional(),
    messageTemplate: z.string().optional(),
    mediaUrl: z.string().url().optional(),
    maxPerUser: z.number().int().min(1).optional(),
    expiresHours: z.number().int().min(1).optional(),
    validFor: z.array(z.string()).optional(),
    active: z.boolean().optional(),
    priority: z.number().int().optional(),
  }),
});

// router.use(authenticateJWT);

router.get("/", couponTemplatesController.list);
router.get("/:type", couponTemplatesController.getByType);
router.post("/", validate(createTemplateSchema), couponTemplatesController.create);
router.patch("/:type", validate(updateTemplateSchema), couponTemplatesController.update);
router.delete("/:type", couponTemplatesController.remove);

module.exports = router;
