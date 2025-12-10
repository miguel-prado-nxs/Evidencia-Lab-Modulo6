const express = require("express");
const router = express.Router();
const settingsController = require("../controllers/settingsController");
const { authenticateJWT, requireAdmin } = require("../middleware/auth");

// Todas las rutas requieren autenticación + admin
router.use(authenticateJWT);
router.use(requireAdmin);

// ========================================
// Configuraciones del Programa
// ========================================

// Obtener todas las configuraciones
router.get("/config", settingsController.getAllConfigs);

// Obtener una configuración específica
router.get("/config/:key", settingsController.getConfig);

// Actualizar una configuración
router.put("/config/:key", settingsController.updateConfig);

// ========================================
// Plantillas de Email
// ========================================

// Listar todas las plantillas
router.get("/email-templates", settingsController.listEmailTemplates);

// Obtener una plantilla
router.get("/email-templates/:id", settingsController.getEmailTemplate);

// Crear una plantilla
router.post("/email-templates", settingsController.createEmailTemplate);

// Actualizar una plantilla
router.put("/email-templates/:id", settingsController.updateEmailTemplate);

// Eliminar una plantilla
router.delete("/email-templates/:id", settingsController.deleteEmailTemplate);

// ========================================
// API Keys
// ========================================

// Listar todas las API keys
router.get("/api-keys", settingsController.listApiKeys);

// Crear una API key
router.post("/api-keys", settingsController.createApiKey);

// Revocar una API key (soft delete)
router.patch("/api-keys/:id/revoke", settingsController.revokeApiKey);

// Eliminar permanentemente una API key
router.delete("/api-keys/:id", settingsController.deleteApiKey);

module.exports = router;

