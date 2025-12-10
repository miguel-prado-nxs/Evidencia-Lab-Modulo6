const express = require("express");
const router = express.Router();
const commissionsController = require("../controllers/commissionsController");
const { authenticateJWT, requireAdmin } = require("../middleware/auth");

// Todas las rutas requieren autenticación
router.use(authenticateJWT);

router.get("/", commissionsController.list);
router.get("/summary", commissionsController.getSummary);

// Rutas de admin
router.get("/stats", requireAdmin, commissionsController.getGlobalStats);
router.get("/pending", requireAdmin, commissionsController.getPending);
router.post("/approve", requireAdmin, commissionsController.approve);
router.post("/pay", requireAdmin, commissionsController.markPaid);
router.get("/export", requireAdmin, commissionsController.exportCommissions);

module.exports = router;

