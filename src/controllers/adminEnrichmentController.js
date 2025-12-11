/**
 * Admin Enrichment Controller
 * Controladores admin para la gestión global de enriquecimientos
 * 
 * ARQUITECTURA:
 * - Mapa DB (prismaGeo): Establecimientos base INEGI/DENUE (800k+) - SOLO LECTURA
 * - Partners DB (prisma): Enriquecimientos - ESCRITURA/LECTURA
 */

const enrichmentService = require("../services/enrichmentService");
const geoService = require("../services/geoService");
const logger = require("../config/logger");
const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");

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
 * 
 * ESTABLISHMENT/CONTACT: Lee de Mapa DB
 * PROSPECT/LEAD/CLIENT: Combina Mapa DB con Partners DB
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
      // Para ESTABLISHMENT y CONTACT: leer de Mapa DB (prismaGeo)
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
              { name: { contains: search, mode: "insensitive" } },
              { businessName: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          },
        ];
      }

      // Obtener total de Mapa DB
      total = await prismaGeo.establishment.count({ where });

      // Obtener establecimientos de Mapa DB
      const establishments = await prismaGeo.establishment.findMany({
        where,
        take: limitNum,
        skip: offset,
        orderBy: level === "CONTACT" 
          ? [{ phone: "desc" }, { email: "desc" }] 
          : { id: "asc" },
      });

      // Obtener enriquecimientos existentes de Partners DB para estos establecimientos
      const establishmentIds = establishments.map(e => e.id);
      const enrichments = await prisma.establishmentEnrichment.findMany({
        where: { establishmentId: { in: establishmentIds } },
        select: {
          establishmentId: true,
          level: true,
          enrichedBy: true,
          updatedAt: true,
        },
      });

      const enrichmentMap = enrichments.reduce((acc, e) => {
        acc[e.establishmentId] = e;
        return acc;
      }, {});

      // Formatear datos
      data = establishments.map((e) => ({
        id: e.id,
        establishmentId: e.id,
        businessName: e.businessName || e.name,
        tradeName: e.name,
        phone: e.phone,
        email: e.email,
        website: e.website,
        address: `${e.streetName || ""} ${e.exteriorNum || ""}, ${e.neighborhood || ""}, ${e.municipalityName || ""}, ${e.stateName || ""}`.trim(),
        state: e.stateName,
        municipality: e.municipalityName,
        latitude: e.latitude,
        longitude: e.longitude,
        level: enrichmentMap[e.id]?.level || level,
        enrichedBy: enrichmentMap[e.id]?.enrichedBy || null,
        updatedAt: enrichmentMap[e.id]?.updatedAt || new Date(),
        partner: null,
      }));

    } else {
      // Para PROSPECT, LEAD, CLIENT: combinar Partners DB con Mapa DB
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

      // Mapear al formato esperado por el frontend
      data = result.data.map((e) => ({
        id: e.id,
        establishmentId: e.establishment?.id || e.establishmentId,
        businessName: e.establishment?.name || "Sin nombre",
        tradeName: null,
        phone: e.establishment?.phone || e.decisionMakerPhone,
        email: e.establishment?.email || e.decisionMakerEmail,
        website: e.establishment?.website,
        address: e.establishment 
          ? `${e.establishment.municipalityName || ""}, ${e.establishment.stateName || ""}`.trim()
          : "",
        state: e.establishment?.stateName,
        municipality: e.establishment?.municipalityName,
        latitude: e.establishment?.latitude,
        longitude: e.establishment?.longitude,
        level: e.level,
        enrichedBy: e.enrichedBy,
        updatedAt: e.updatedAt,
        partner: e.partner,
        // Datos adicionales de enriquecimiento
        decisionMakerName: e.decisionMakerName,
        decisionMakerPosition: e.decisionMakerPosition,
        decisionMakerPhone: e.decisionMakerPhone,
        decisionMakerWhatsApp: e.decisionMakerWhatsApp,
        intent: e.intent,
        fear: e.fear,
        pain: e.pain,
        desire: e.desire,
      }));
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
