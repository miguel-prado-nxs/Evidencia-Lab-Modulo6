/**
 * Admin Enrichment Controller
 * Controladores admin para la gestión global de enriquecimientos
 */

const enrichmentService = require("../services/enrichmentService");
const logger = require("../config/logger");

/**
 * GET /api/v1/geo/enrichment/admin
 * Obtener todos los enriquecimientos (paginado, filtrable)
 */
async function getAllEnrichments(req, res, next) {
  try {
    const {
      partnerId,
      level,
      state,
      municipality,
      search,
      page = 1,
      limit = 20,
      sortBy = "updatedAt",
      sortOrder = "desc",
    } = req.query;

    const result = await enrichmentService.getAllEnrichments({
      partnerId,
      level,
      state,
      municipality,
      search,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sortBy,
      sortOrder,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Error en getAllEnrichments (admin):", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/enrichment/admin/stats
 * Obtener estadísticas globales por partner
 */
async function getGlobalStats(req, res, next) {
  try {
    const stats = await enrichmentService.getGlobalStatsByPartner();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error en getGlobalStats (admin):", error);
    next(error);
  }
}

/**
 * DELETE /api/v1/geo/enrichment/admin/:establishmentId
 * Eliminar un enriquecimiento (sin validación de permisos)
 */
async function deleteEnrichment(req, res, next) {
  try {
    const { establishmentId } = req.params;

    await enrichmentService.adminDeleteEnrichment(establishmentId);

    res.json({
      success: true,
      message: "Enriquecimiento eliminado correctamente",
    });
  } catch (error) {
    logger.error("Error en deleteEnrichment (admin):", error);
    if (error.message === "Enriquecimiento no encontrado") {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
}

module.exports = {
  getAllEnrichments,
  getGlobalStats,
  deleteEnrichment,
};

