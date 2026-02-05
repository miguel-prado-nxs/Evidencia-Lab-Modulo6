const express = require("express");
const router = express.Router();
const leadsController = require("../controllers/leadsController");
const { authenticateJWT, authenticateApiKey, authenticateJWTOrServiceKey } = require("../middleware/auth");
const { validateEnrichmentAgent } = require("../middleware/enrichmentAgent");
const { validate } = require("../middleware/validation");
const { z } = require("zod");

// Schema para crear lead
const createLeadSchema = z.object({
  body: z.object({
    businessName: z.string().min(1, "Nombre del negocio requerido"),
    contactName: z.string().min(1, "Nombre de contacto requerido"),
    email: z.string().email("Email inválido"),
    phone: z.string().optional(),
    businessType: z.string().optional(),
    location: z.string().optional(),
    monthlyOrders: z.string().optional(),
    interests: z.array(z.string()).optional(),
    utmSource: z.string().optional(),
    utmMedium: z.string().optional(),
    utmCampaign: z.string().optional(),
    utmTerm: z.string().optional(),
    utmContent: z.string().optional(),
    landingPage: z.string().optional(),
    referrer: z.string().optional(),
    notes: z.string().optional(),
  }),
});

// Schema para tracking (público)
const trackLeadSchema = z.object({
  body: z.object({
    partnerCode: z.string().min(1, "Código de partner requerido"),
    businessName: z.string().min(1, "Nombre del negocio requerido"),
    contactName: z.string().min(1, "Nombre de contacto requerido"),
    email: z.string().email("Email inválido"),
    phone: z.string().optional(),
    businessType: z.string().optional(),
    location: z.string().optional(),
    monthlyOrders: z.string().optional(),
    interests: z.array(z.string()).optional(),
    utmSource: z.string().optional(),
    utmMedium: z.string().optional(),
    utmCampaign: z.string().optional(),
    utmTerm: z.string().optional(),
    utmContent: z.string().optional(),
    landingPage: z.string().optional(),
    referrer: z.string().optional(),
  }),
});

// Ruta pública para tracking (con API Key)
router.post("/track", authenticateApiKey, validate(trackLeadSchema), leadsController.track);

// Rutas protegidas para agente de enriquecimiento
// NOTA: Cambiar validateEnrichmentAgent por authenticateJWTOrServiceKey para que extraiga salesPartnerId
router.post("/auto-enrich", authenticateJWTOrServiceKey, leadsController.autoEnrich);
router.post("/auto-qualify", authenticateJWTOrServiceKey, leadsController.autoQualify);

// Ruta para que agentes actualicen email (con autenticación por API key)
router.patch("/:id/email", validateEnrichmentAgent, leadsController.updateEmail);

// Rutas protegidas
router.use(authenticateJWT);

router.get("/", leadsController.list);
router.get("/:id", leadsController.getById);
router.post("/", validate(createLeadSchema), leadsController.create);
router.patch("/:id", leadsController.update);
router.patch("/:id/status", leadsController.updateStatus);

module.exports = router;
