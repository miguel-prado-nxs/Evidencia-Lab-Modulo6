const express = require("express");
const router = express.Router();
const dealsController = require("../controllers/dealsController");
const { authenticateJWT, requireAdmin } = require("../middleware/auth");
const { validate } = require("../middleware/validation");
const { z } = require("zod");

// Schema para crear deal
const createDealSchema = z.object({
  body: z.object({
    leadId: z.string().uuid("Lead ID inválido"),
    customerId: z.string().optional(),
    planType: z.string().min(1, "Tipo de plan requerido"),
    planPrice: z.number().positive("El precio debe ser positivo"),
    setupFee: z.number().min(0).optional(),
  }),
});

// Todas las rutas requieren autenticación
router.use(authenticateJWT);

router.get("/", dealsController.list);
router.get("/:id", dealsController.getById);

// Solo admin puede crear y actualizar deals
router.post("/", requireAdmin, validate(createDealSchema), dealsController.create);
router.patch("/:id/status", requireAdmin, dealsController.updateStatus);

module.exports = router;

