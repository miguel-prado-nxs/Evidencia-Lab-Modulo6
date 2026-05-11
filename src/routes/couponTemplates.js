const express = require("express");
const router = express.Router();
const couponTemplatesController = require("../controllers/couponTemplatesController");
const { authenticateJWT, requireAdmin, verifyJWTLight, requireAdminLight } = require("../middleware/auth");
const { uploadSingle } = require("../middleware/upload");
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
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional(),
    validDays: z.array(z.string()).optional(),
    validFor: z.array(z.string()).optional(),
    priority: z.number().int().optional(),
    stripe_product_id: z.string().optional()

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
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional(),
    validDays: z.array(z.string()).optional(),
    validFor: z.array(z.string()).optional(),
    active: z.boolean().optional(),
    priority: z.number().int().optional(),
    stripe_product_id: z.string().optional()
  }),
});

// router.use(authenticateJWT);

// La ruta debe ir antes de /:type para que no sea capturada como parámetro.
// Usa verifyJWTLight (sin DB lookup) porque el login vive en demo-form-service:
// el userId del token NO existe en la tabla users de este backend.
router.post("/upload-image", verifyJWTLight, requireAdminLight, uploadSingle, couponTemplatesController.uploadImage);

router.get("/", couponTemplatesController.list);
router.get("/products", couponTemplatesController.getProductsFromStripe);
router.post("/sync-stripe", couponTemplatesController.syncWithStripe);
router.get("/:type", couponTemplatesController.getByType);
router.post("/", validate(createTemplateSchema), couponTemplatesController.create);
router.patch("/:type", validate(updateTemplateSchema), couponTemplatesController.update);
router.delete("/:type", couponTemplatesController.remove);

module.exports = router;
