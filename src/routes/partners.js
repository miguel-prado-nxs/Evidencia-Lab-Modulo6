const express = require("express");
const router = express.Router();
const partnersController = require("../controllers/partnersController");
const { authenticateJWT, requireAdmin } = require("../middleware/auth");

// Rutas públicas
router.get("/validate/:code", partnersController.validateCode);

// Rutas protegidas
router.use(authenticateJWT);

// Rutas del partner autenticado (DEBEN ir antes de /:id)
router.get("/me", partnersController.getMyProfile);
router.patch("/me", partnersController.updateMyProfile);
router.patch("/me/user", partnersController.updateMyUser);

// Lista de partners (admin)
router.get("/", requireAdmin, partnersController.list);

// Crear partner (admin)
router.post("/", requireAdmin, partnersController.create);

// Obtener partner por ID
router.get("/:id", partnersController.getById);

// Actualizar partner
router.patch("/:id", partnersController.update);

// Cambiar status (admin)
router.patch("/:id/status", requireAdmin, partnersController.updateStatus);

// Cambiar tier (admin)
router.patch("/:id/tier", requireAdmin, partnersController.updateTier);

// Estadísticas del partner
router.get("/:id/stats", partnersController.getStats);

module.exports = router;

