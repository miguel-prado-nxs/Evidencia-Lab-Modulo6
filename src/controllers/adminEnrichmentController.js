/**
 * Admin Enrichment Controller
 * Controladores admin para la gestión global de enriquecimientos
 */

const enrichmentService = require("../services/enrichmentService");
const geoService = require("../services/geoService");
const logger = require("../config/logger");
const prismaGeo = require("../config/databaseGeo");

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

/**
 * GET /api/v1/geo/enrichment/admin/by-level/:level
 * Obtener establecimientos por nivel con info de partner si existe
 * Niveles: ESTABLISHMENT, CONTACT, PROSPECT, LEAD, CLIENT
 */
async function getByLevel(req, res, next) {
  try {
    const { level } = req.params;
    const {
      page = 1,
      limit = 50,
      search,
      state,
      municipality,
      partnerId,
      sortBy = "updatedAt",
      sortOrder = "desc",
    } = req.query;

    // Validar nivel
    const validLevels = ["ESTABLISHMENT", "CONTACT", "PROSPECT", "LEAD", "CLIENT"];
    if (!validLevels.includes(level)) {
      return res.status(400).json({
        success: false,
        error: `Nivel inválido. Debe ser uno de: ${validLevels.join(", ")}`,
      });
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    let data = [];
    let total = 0;

    if (level === "ESTABLISHMENT" || level === "CONTACT") {
      // Para ESTABLISHMENT y CONTACT: obtener de la tabla base de establecimientos
      const where = {};

      // Filtro para CONTACT: solo con datos de contacto
      if (level === "CONTACT") {
        where.OR = [
          { phone: { not: null } },
          { email: { not: null } },
          { website: { not: null } },
        ];
      }

      // Filtro por estado
      if (state) {
        where.stateCode = state;
      }

      // Filtro por municipio
      if (municipality) {
        where.municipalityCode = municipality;
      }

      // Filtro por búsqueda
      if (search) {
        where.AND = [
          ...(where.AND || []),
          {
            OR: [
              { businessName: { contains: search, mode: "insensitive" } },
              { tradeName: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          },
        ];
      }

      // Obtener total
      total = await prismaGeo.establishment.count({ where });

      // Obtener establecimientos
      const establishments = await prismaGeo.establishment.findMany({
        where,
        take: limitNum,
        skip: offset,
        orderBy: level === "CONTACT" 
          ? [{ phone: "desc" }, { email: "desc" }] 
          : { id: "asc" },
        include: {
          enrichment: {
            select: {
              level: true,
              enrichedBy: true,
              updatedAt: true,
            },
          },
        },
      });

      // Formatear datos
      data = establishments.map((e) => ({
        id: e.id,
        establishmentId: e.id,
        businessName: e.businessName,
        tradeName: e.tradeName,
        phone: e.phone,
        email: e.email,
        website: e.website,
        address: `${e.street || ""} ${e.extNumber || ""}, ${e.neighborhood || ""}, ${e.municipality || ""}, ${e.state || ""}`.trim(),
        state: e.state,
        municipality: e.municipality,
        latitude: e.latitude,
        longitude: e.longitude,
        level: e.enrichment?.level || level,
        enrichedBy: e.enrichment?.enrichedBy || null,
        updatedAt: e.enrichment?.updatedAt || e.createdAt || new Date(),
        partner: null, // Los datos base no tienen partner asociado
      }));

    } else {
      // Para PROSPECT, LEAD, CLIENT: usar enriquecimientos con filtro de nivel
      const result = await enrichmentService.getAllEnrichments({
        partnerId,
        level,
        state,
        municipality,
        search,
        page: pageNum,
        limit: limitNum,
        sortBy,
        sortOrder,
      });

      data = result.data;
      total = result.total;
    }

    res.json({
      success: true,
      data,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      limit: limitNum,
      level,
    });
  } catch (error) {
    logger.error("Error en getByLevel (admin):", error);
    next(error);
  }
}

module.exports = {
  getAllEnrichments,
  getGlobalStats,
  deleteEnrichment,
  getByLevel,
};

