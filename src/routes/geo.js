/**
 * GeoInsights Routes
 * Rutas para la API de datos geográficos DENUE
 */

const express = require("express");
const router = express.Router();
const geoController = require("../controllers/geoController");
const { authenticateJWT, optionalAuth } = require("../middleware/auth");

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
 * GET /api/v1/geo/search
 * Buscar establecimientos por texto
 * Query params: q (min 3 chars), limit
 */
router.get("/search", geoController.searchEstablishments);

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

module.exports = router;
