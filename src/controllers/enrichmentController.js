/**
 * Enrichment Controller
 * Controladores para la API de enriquecimiento de establecimientos
 */

const enrichmentService = require("../services/enrichmentService");
const logger = require("../config/logger");

/**
 * GET /api/v1/geo/enrichment/:establishmentId
 * Obtener datos de enriquecimiento de un establecimiento
 */
async function getEnrichment(req, res, next) {
  try {
    const { establishmentId } = req.params;

    const enrichment = await enrichmentService.getEnrichmentByEstablishment(establishmentId);

    if (!enrichment) {
      return res.json({
        success: true,
        data: null,
        message: "No hay datos de enriquecimiento para este establecimiento",
      });
    }

    res.json({
      success: true,
      data: enrichment,
    });
  } catch (error) {
    logger.error("Error en getEnrichment:", error);
    next(error);
  }
}

/**
 * POST /api/v1/geo/enrichment/:establishmentId
 * Crear o actualizar enriquecimiento de un establecimiento
 */
async function updateEnrichment(req, res, next) {
  try {
    const { establishmentId } = req.params;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "Solo partners pueden enriquecer establecimientos",
      });
    }

    const data = req.body;

    // Validar que al menos hay algún dato
    const hasDecisionMakerData = data.decisionMakerName || data.decisionMakerPhone || data.decisionMakerWhatsApp;
    const hasQualificationData = data.intent || data.fear || data.pain || data.desire;

    if (!hasDecisionMakerData && !hasQualificationData) {
      return res.status(400).json({
        success: false,
        error: "Se requiere al menos información del tomador de decisiones o de cualificación",
      });
    }

    const enrichment = await enrichmentService.createOrUpdateEnrichment(
      establishmentId,
      data,
      partnerId
    );

    res.json({
      success: true,
      data: enrichment,
      message: "Enriquecimiento guardado correctamente",
    });
  } catch (error) {
    logger.error("Error en updateEnrichment:", error);
    if (error.message === "Establecimiento no encontrado") {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
}

/**
 * POST /api/v1/geo/enrichment/import
 * Importar múltiples enriquecimientos desde CSV/JSON
 */
async function bulkImport(req, res, next) {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "Solo partners pueden importar enriquecimientos",
      });
    }

    const { data } = req.body;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Se requiere un array de datos para importar",
      });
    }

    // Limitar la cantidad de registros por importación
    const MAX_IMPORT_SIZE = 500;
    if (data.length > MAX_IMPORT_SIZE) {
      return res.status(400).json({
        success: false,
        error: `Máximo ${MAX_IMPORT_SIZE} registros por importación`,
      });
    }

    const results = await enrichmentService.bulkImportEnrichments(data, partnerId);

    res.json({
      success: true,
      data: results,
      message: `Importación completada: ${results.success}/${results.total} exitosos`,
    });
  } catch (error) {
    logger.error("Error en bulkImport:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/stats/levels
 * Obtener estadísticas por nivel de enriquecimiento
 */
async function getStatsByLevel(req, res, next) {
  try {
    const stats = await enrichmentService.getStatsByLevel();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error en getStatsByLevel:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/enrichment/my
 * Obtener enriquecimientos realizados por el partner autenticado
 */
async function getMyEnrichments(req, res, next) {
  try {
    const partnerId = req.user.partner?.id;
    const { level } = req.query;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "Solo partners pueden ver sus enriquecimientos",
      });
    }

    const enrichments = await enrichmentService.getEnrichmentsByPartner(partnerId, level);

    res.json({
      success: true,
      data: enrichments,
      count: enrichments.length,
    });
  } catch (error) {
    logger.error("Error en getMyEnrichments:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/enrichment/my/stats
 * Obtener estadísticas por nivel del partner autenticado
 */
async function getMyStats(req, res, next) {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "Solo partners pueden ver sus estadísticas",
      });
    }

    const stats = await enrichmentService.getStatsByLevelForPartner(partnerId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error en getMyStats:", error);
    next(error);
  }
}

/**
 * DELETE /api/v1/geo/enrichment/:establishmentId
 * Eliminar un enriquecimiento
 */
async function deleteEnrichment(req, res, next) {
  try {
    const { establishmentId } = req.params;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "Solo partners pueden eliminar enriquecimientos",
      });
    }

    await enrichmentService.deleteEnrichment(establishmentId, partnerId);

    res.json({
      success: true,
      message: "Enriquecimiento eliminado correctamente",
    });
  } catch (error) {
    logger.error("Error en deleteEnrichment:", error);
    if (error.message.includes("no encontrado") || error.message.includes("No tienes permisos")) {
      return res.status(error.message.includes("permisos") ? 403 : 404).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
}

module.exports = {
  getEnrichment,
  updateEnrichment,
  bulkImport,
  getStatsByLevel,
  getMyEnrichments,
  getMyStats,
  deleteEnrichment,
};

