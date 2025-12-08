/**
 * GeoInsights Routes
 * Rutas para la API de datos geográficos DENUE
 */

const express = require("express");
const router = express.Router();
const geoController = require("../controllers/geoController");
const enrichmentController = require("../controllers/enrichmentController");
const adminEnrichmentController = require("../controllers/adminEnrichmentController");
const { authenticateJWT, optionalAuth, requireAdmin } = require("../middleware/auth");

// ============================================
// RUTAS PÚBLICAS (Solo lectura de datos)
// ============================================

/**
 * GET /api/v1/geo/establishments
 * Obtener establecimientos en un área geográfica
 * Query params: north, south, east, west, activity, state, municipality, employees, search, limit, offset
 */
router.get("/establishments", geoController.getEstablishments);

/**
 * GET /api/v1/geo/establishments/:id
 * Obtener detalle de un establecimiento
 */
router.get("/establishments/:id", geoController.getEstablishmentById);

/**
 * GET /api/v1/geo/clusters
 * Obtener datos clusterizados para el mapa
 * Query params: north, south, east, west, zoom
 */
router.get("/clusters", geoController.getClusters);

/**
 * GET /api/v1/geo/heatmap
 * Obtener datos para heatmap
 * Query params: north, south, east, west, activity, state
 */
router.get("/heatmap", geoController.getHeatmap);

/**
 * GET /api/v1/geo/zones
 * Obtener zonas geográficas (estados, municipios)
 * Query params: type (STATE, MUNICIPALITY, CUSTOM)
 */
router.get("/zones", geoController.getZones);

/**
 * GET /api/v1/geo/stats
 * Obtener estadísticas por zona
 * Query params: state, municipality
 */
router.get("/stats", geoController.getStats);

/**
 * GET /api/v1/geo/stats/levels
 * Obtener estadísticas por nivel de enriquecimiento
 * Returns: { ESTABLISHMENT: n, CONTACT: n, PROSPECT: n, LEAD: n }
 */
router.get("/stats/levels", enrichmentController.getStatsByLevel);

/**
 * GET /api/v1/geo/establishments/level/:level
 * Obtener establecimientos filtrados por nivel
 * Params: level (ESTABLISHMENT, CONTACT, PROSPECT, LEAD)
 * Query params: north, south, east, west, activity, limit, offset
 */
router.get("/establishments/level/:level", geoController.getEstablishmentsByLevel);

/**
 * GET /api/v1/geo/search
 * Buscar establecimientos por texto
 * Query params: q (min 3 chars), limit
 */
router.get("/search", geoController.searchEstablishments);

/**
 * GET /api/v1/geo/smart-search
 * Búsqueda inteligente con resultados priorizados
 * Query params: q (min 2 chars), activity, limit
 * Returns: { states: [], municipalities: [], establishments: [] }
 */
router.get("/smart-search", geoController.smartSearch);

/**
 * GET /api/v1/geo/activities
 * Obtener categorías de actividad ordenadas por frecuencia
 * Returns: [{ code, name, count }]
 */
router.get("/activities", geoController.getActivities);

/**
 * GET /api/v1/geo/states
 * Obtener lista de estados con conteo de establecimientos
 * Returns: [{ id, name, stateCode, totalEstablishments, centerLat, centerLng }]
 */
router.get("/states", geoController.getStates);

/**
 * GET /api/v1/geo/states/:stateCode/municipalities
 * Obtener municipios de un estado específico
 * Returns: [{ id, name, municipalityCode, totalEstablishments, centerLat, centerLng }]
 */
router.get("/states/:stateCode/municipalities", geoController.getMunicipalities);

// ============================================
// RUTAS PROTEGIDAS (Requieren autenticación)
// ============================================

/**
 * POST /api/v1/geo/prospects/assign
 * Asignar un establecimiento como prospect
 * Body: { establishmentId, notes }
 */
router.post("/prospects/assign", authenticateJWT, geoController.assignProspect);

/**
 * POST /api/v1/geo/prospects/:id/convert
 * Convertir un prospect a lead
 * Body: { contactName, email, phone, interests }
 */
router.post("/prospects/:id/convert", authenticateJWT, geoController.convertProspect);

/**
 * GET /api/v1/geo/prospects
 * Obtener prospects del partner autenticado
 * Query params: status
 */
router.get("/prospects", authenticateJWT, geoController.getMyProspects);

// ============================================
// RUTAS DE ENRIQUECIMIENTO (Sistema 4 Mapas)
// ============================================

/**
 * GET /api/v1/geo/enrichment/my
 * Obtener enriquecimientos realizados por el partner autenticado
 * Query params: level (optional)
 */
router.get("/enrichment/my", authenticateJWT, enrichmentController.getMyEnrichments);

/**
 * GET /api/v1/geo/enrichment/my/stats
 * Obtener estadísticas por nivel del partner autenticado
 * Returns: { CONTACT: n, PROSPECT: n, LEAD: n, CLIENT: n }
 */
router.get("/enrichment/my/stats", authenticateJWT, enrichmentController.getMyStats);

/**
 * POST /api/v1/geo/enrichment/import
 * Importar múltiples enriquecimientos desde CSV/JSON
 * Body: { data: [{ establishmentId, decisionMakerName, ... }] }
 */
router.post("/enrichment/import", authenticateJWT, enrichmentController.bulkImport);

/**
 * GET /api/v1/geo/enrichment/:establishmentId
 * Obtener datos de enriquecimiento de un establecimiento
 */
router.get("/enrichment/:establishmentId", authenticateJWT, enrichmentController.getEnrichment);

/**
 * POST /api/v1/geo/enrichment/:establishmentId
 * Crear o actualizar enriquecimiento de un establecimiento
 * Body: { decisionMakerName, decisionMakerPosition, decisionMakerPhone, 
 *         decisionMakerWhatsApp, decisionMakerEmail, intent, fear, pain, desire }
 */
router.post("/enrichment/:establishmentId", authenticateJWT, enrichmentController.updateEnrichment);

/**
 * DELETE /api/v1/geo/enrichment/:establishmentId
 * Eliminar un enriquecimiento
 */
router.delete("/enrichment/:establishmentId", authenticateJWT, enrichmentController.deleteEnrichment);

// ============================================
// RUTAS ADMIN (Requieren rol ADMIN)
// ============================================

/**
 * GET /api/v1/geo/enrichment/admin
 * Obtener todos los enriquecimientos (paginado, filtrable)
 * Query params: partnerId, level, state, municipality, search, page, limit, sortBy, sortOrder
 */
router.get("/enrichment/admin", requireAdmin, adminEnrichmentController.getAllEnrichments);

/**
 * GET /api/v1/geo/enrichment/admin/stats
 * Obtener estadísticas globales por partner
 * Returns: { global: {...}, byPartner: [...] }
 */
router.get("/enrichment/admin/stats", requireAdmin, adminEnrichmentController.getGlobalStats);

/**
 * DELETE /api/v1/geo/enrichment/admin/:establishmentId
 * Eliminar un enriquecimiento (sin validación de permisos)
 */
router.delete("/enrichment/admin/:establishmentId", requireAdmin, adminEnrichmentController.deleteEnrichment);

module.exports = router;
