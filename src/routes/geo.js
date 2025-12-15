/**
 * GeoInsights Routes
 * Rutas para la API de datos geográficos DENUE
 */

const express = require("express");
const router = express.Router();
const geoController = require("../controllers/geoController");
const enrichmentController = require("../controllers/enrichmentController");
const adminEnrichmentController = require("../controllers/adminEnrichmentController");
const meetingController = require("../controllers/meetingController");
const { authenticateJWT, authenticateJWTOrServiceKey, optionalAuth, requireAdmin } = require("../middleware/auth");

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
// RUTAS PROTEGIDAS (Requieren autenticación JWT o Service Key)
// ============================================

/**
 * POST /api/v1/geo/prospects/assign
 * Asignar un establecimiento como prospect
 * Body: { establishmentId, notes }
 */
router.post("/prospects/assign", authenticateJWTOrServiceKey, geoController.assignProspect);

/**
 * POST /api/v1/geo/prospects/:id/convert
 * Convertir un prospect a lead
 * Body: { contactName, email, phone, interests }
 */
router.post("/prospects/:id/convert", authenticateJWTOrServiceKey, geoController.convertProspect);

/**
 * GET /api/v1/geo/prospects
 * Obtener prospects del partner autenticado
 * Query params: status
 */
router.get("/prospects", authenticateJWTOrServiceKey, geoController.getMyProspects);

// ============================================
// RUTAS DE ENRIQUECIMIENTO (Sistema 4 Mapas)
// ============================================

/**
 * GET /api/v1/geo/enrichment/my
 * Obtener enriquecimientos realizados por el partner autenticado
 * Query params: level (optional)
 */
router.get("/enrichment/my", authenticateJWTOrServiceKey, enrichmentController.getMyEnrichments);

/**
 * GET /api/v1/geo/enrichment/my/stats
 * Obtener estadísticas por nivel del partner autenticado
 * Returns: { CONTACT: n, PROSPECT: n, LEAD: n, CLIENT: n }
 */
router.get("/enrichment/my/stats", authenticateJWTOrServiceKey, enrichmentController.getMyStats);

/**
 * GET /api/v1/geo/enrichment/meetings
 * Obtener meetings programados en un rango de fechas
 * Query params: startDate, endDate
 */
router.get("/enrichment/meetings", authenticateJWTOrServiceKey, enrichmentController.getScheduledMeetings);

/**
 * POST /api/v1/geo/enrichment/import
 * Importar múltiples enriquecimientos desde CSV/JSON
 * Body: { data: [{ establishmentId, decisionMakerName, ... }] }
 */
router.post("/enrichment/import", authenticateJWTOrServiceKey, enrichmentController.bulkImport);

// ============================================
// RUTAS ADMIN (Requieren rol ADMIN)
// NOTA: Deben ir ANTES de /enrichment/:establishmentId para evitar conflictos
// ============================================

/**
 * GET /api/v1/geo/enrichment/admin
 * Obtener todos los enriquecimientos (paginado, filtrable)
 * Query params: partnerId, level, state, municipality, search, page, limit, sortBy, sortOrder
 */
router.get("/enrichment/admin", authenticateJWT, requireAdmin, adminEnrichmentController.getAllEnrichments);

/**
 * GET /api/v1/geo/enrichment/admin/stats
 * Obtener estadísticas globales por partner
 * Returns: { global: {...}, byPartner: [...] }
 */
router.get("/enrichment/admin/stats", authenticateJWT, requireAdmin, adminEnrichmentController.getGlobalStats);

/**
 * GET /api/v1/geo/enrichment/admin/by-level/:level
 * Obtener establecimientos por nivel con info de partner si existe
 * Niveles: ESTABLISHMENT, CONTACT, PROSPECT, LEAD, CLIENT
 * Query params: page, limit, search, state, municipality, partnerId, sortBy, sortOrder
 */
router.get("/enrichment/admin/by-level/:level", authenticateJWT, requireAdmin, adminEnrichmentController.getByLevel);

/**
 * DELETE /api/v1/geo/enrichment/admin/:establishmentId
 * Eliminar un enriquecimiento (sin validación de permisos)
 */
router.delete("/enrichment/admin/:establishmentId", authenticateJWT, requireAdmin, adminEnrichmentController.deleteEnrichment);

// ============================================
// RUTAS DE MEETINGS (Sistema de Agendamiento)
// ============================================

/**
 * GET /api/v1/geo/meetings
 * Obtener meetings programados en un rango de fechas
 * Query params: startDate, endDate
 */
router.get("/meetings", authenticateJWTOrServiceKey, meetingController.getScheduledMeetings);

/**
 * GET /api/v1/geo/meetings/my
 * Obtener todos los meetings del partner autenticado
 * Query params: onlyScheduled (boolean)
 */
router.get("/meetings/my", authenticateJWTOrServiceKey, meetingController.getMyMeetings);

/**
 * GET /api/v1/geo/meetings/stats
 * Obtener estadísticas de meetings del partner
 */
router.get("/meetings/stats", authenticateJWTOrServiceKey, meetingController.getMeetingStats);

/**
 * GET /api/v1/geo/meetings/:establishmentId
 * Obtener meeting de un establecimiento específico
 */
router.get("/meetings/:establishmentId", authenticateJWTOrServiceKey, meetingController.getMeeting);

/**
 * PATCH /api/v1/geo/meetings/:establishmentId
 * Actualizar meeting de un establecimiento
 * Body: { meetingScheduled, meetingDate, meetingLink, notes }
 */
router.patch("/meetings/:establishmentId", authenticateJWTOrServiceKey, meetingController.updateMeeting);

/**
 * POST /api/v1/geo/meetings/:establishmentId/calendly
 * Crear meeting usando Calendly y enviar invitación al cliente
 * Requiere que el establecimiento tenga email registrado
 * Body: { startTime, endTime, notes }
 */
router.post("/meetings/:establishmentId/calendly", authenticateJWTOrServiceKey, meetingController.createMeetingWithCalendly);

/**
 * DELETE /api/v1/geo/meetings/:establishmentId
 * Eliminar meeting de un establecimiento
 */
router.delete("/meetings/:establishmentId", authenticateJWTOrServiceKey, meetingController.deleteMeeting);

// ============================================
// RUTAS DE ENRIQUECIMIENTO CON PARÁMETRO (deben ir al final)
// ============================================

/**
 * GET /api/v1/geo/enrichment/:establishmentId
 * Obtener datos de enriquecimiento de un establecimiento
 */
router.get("/enrichment/:establishmentId", authenticateJWTOrServiceKey, enrichmentController.getEnrichment);

/**
 * POST /api/v1/geo/enrichment/:establishmentId
 * Crear o actualizar enriquecimiento de un establecimiento
 * Body: { decisionMakerName, decisionMakerPosition, decisionMakerPhone, 
 *         decisionMakerWhatsApp, decisionMakerEmail, intent, fear, pain, desire }
 */
router.post("/enrichment/:establishmentId", authenticateJWTOrServiceKey, enrichmentController.updateEnrichment);

/**
 * PATCH /api/v1/geo/enrichment/:establishmentId/meeting
 * Actualizar datos de meeting de un enriquecimiento
 * Body: { meetingScheduled, meetingDate, meetingLink }
 */
router.patch("/enrichment/:establishmentId/meeting", authenticateJWTOrServiceKey, enrichmentController.updateMeetingDetails);

/**
 * DELETE /api/v1/geo/enrichment/:establishmentId
 * Eliminar un enriquecimiento
 */
router.delete("/enrichment/:establishmentId", authenticateJWTOrServiceKey, enrichmentController.deleteEnrichment);

module.exports = router;
