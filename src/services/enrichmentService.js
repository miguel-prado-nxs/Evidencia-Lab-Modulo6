/**
 * Enrichment Service
 * Servicios para enriquecimiento de establecimientos con información adicional
 * Gestiona los niveles: ESTABLISHMENT -> CONTACT -> PROSPECT -> LEAD
 */

const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");

/**
 * Calcular el nivel de un establecimiento basado en sus datos
 * @param {Object} establishment - Datos del establecimiento DENUE
 * @param {Object|null} enrichment - Datos de enriquecimiento adicionales
 * @returns {string} - Nivel: ESTABLISHMENT | CONTACT | PROSPECT | LEAD
 */
function calculateLevel(establishment, enrichment = null) {
  // Nivel LEAD: tiene toda la información de cualificación
  if (
    enrichment?.intent &&
    enrichment?.fear &&
    enrichment?.pain &&
    enrichment?.desire
  ) {
    return "LEAD";
  }

  // Nivel PROSPECT: tiene info del tomador de decisiones
  if (
    enrichment?.decisionMakerName &&
    (enrichment?.decisionMakerPhone || enrichment?.decisionMakerWhatsApp)
  ) {
    return "PROSPECT";
  }

  // Nivel CONTACT: tiene algún método de contacto (datos DENUE)
  if (establishment?.phone || establishment?.email || establishment?.website) {
    return "CONTACT";
  }

  // Nivel base: solo datos DENUE
  return "ESTABLISHMENT";
}

/**
 * Obtener el enriquecimiento de un establecimiento por ID
 * @param {string} establishmentId - ID del establecimiento
 * @returns {Promise<Object|null>} - Datos de enriquecimiento o null
 */
async function getEnrichmentByEstablishment(establishmentId) {
  try {
    const enrichment = await prismaGeo.establishmentEnrichment.findUnique({
      where: { establishmentId },
      include: {
        establishment: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            website: true,
            activityName: true,
            municipalityName: true,
            stateName: true,
          },
        },
      },
    });

    return enrichment;
  } catch (error) {
    logger.error("Error obteniendo enriquecimiento:", error);
    throw error;
  }
}

/**
 * Crear o actualizar el enriquecimiento de un establecimiento
 * @param {string} establishmentId - ID del establecimiento
 * @param {Object} data - Datos de enriquecimiento
 * @param {string} partnerId - ID del partner que enriquece
 * @returns {Promise<Object>} - Enriquecimiento creado/actualizado
 */
async function createOrUpdateEnrichment(establishmentId, data, partnerId) {
  try {
    // Obtener el establecimiento para calcular el nivel
    const establishment = await prismaGeo.establishment.findUnique({
      where: { id: establishmentId },
      select: {
        id: true,
        phone: true,
        email: true,
        website: true,
      },
    });

    if (!establishment) {
      throw new Error("Establecimiento no encontrado");
    }

    // Preparar datos de enriquecimiento
    const enrichmentData = {
      decisionMakerName: data.decisionMakerName || null,
      decisionMakerPosition: data.decisionMakerPosition || null,
      decisionMakerPhone: data.decisionMakerPhone || null,
      decisionMakerWhatsApp: data.decisionMakerWhatsApp || null,
      decisionMakerEmail: data.decisionMakerEmail || null,
      intent: data.intent || null,
      fear: data.fear || null,
      pain: data.pain || null,
      desire: data.desire || null,
      lastUpdatedBy: partnerId,
    };

    // Calcular nivel basado en los nuevos datos
    const level = calculateLevel(establishment, enrichmentData);
    enrichmentData.level = level;

    // Buscar si ya existe un enriquecimiento
    const existing = await prismaGeo.establishmentEnrichment.findUnique({
      where: { establishmentId },
    });

    let enrichment;

    if (existing) {
      // Actualizar existente
      enrichment = await prismaGeo.establishmentEnrichment.update({
        where: { establishmentId },
        data: enrichmentData,
        include: {
          establishment: {
            select: {
              id: true,
              name: true,
              activityName: true,
              phone: true,
              email: true,
              website: true,
              municipalityName: true,
              stateName: true,
            },
          },
        },
      });
      logger.info(`Enriquecimiento actualizado para establecimiento ${establishmentId} - Nivel: ${level}`);
    } else {
      // Crear nuevo
      enrichment = await prismaGeo.establishmentEnrichment.create({
        data: {
          ...enrichmentData,
          establishmentId,
          enrichedBy: partnerId,
          enrichedAt: new Date(),
        },
        include: {
          establishment: {
            select: {
              id: true,
              name: true,
              activityName: true,
              phone: true,
              email: true,
              website: true,
              municipalityName: true,
              stateName: true,
            },
          },
        },
      });
      logger.info(`Enriquecimiento creado para establecimiento ${establishmentId} - Nivel: ${level}`);
    }

    return enrichment;
  } catch (error) {
    logger.error("Error creando/actualizando enriquecimiento:", error);
    throw error;
  }
}

/**
 * Importar enriquecimientos en lote desde CSV/JSON
 * @param {Array<Object>} data - Array de datos de enriquecimiento
 * @param {string} partnerId - ID del partner que importa
 * @returns {Promise<Object>} - Resultado de la importación
 */
async function bulkImportEnrichments(data, partnerId) {
  const results = {
    total: data.length,
    success: 0,
    failed: 0,
    errors: [],
  };

  for (const item of data) {
    try {
      // Validar que tenga establishmentId
      if (!item.establishmentId) {
        results.failed++;
        results.errors.push({
          item,
          error: "establishmentId es requerido",
        });
        continue;
      }

      // Verificar que el establecimiento existe
      const establishment = await prismaGeo.establishment.findUnique({
        where: { id: item.establishmentId },
      });

      if (!establishment) {
        results.failed++;
        results.errors.push({
          establishmentId: item.establishmentId,
          error: "Establecimiento no encontrado",
        });
        continue;
      }

      // Crear o actualizar el enriquecimiento
      await createOrUpdateEnrichment(item.establishmentId, item, partnerId);
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        establishmentId: item.establishmentId,
        error: error.message,
      });
    }
  }

  logger.info(`Importación masiva completada: ${results.success}/${results.total} exitosos`);
  return results;
}

/**
 * Obtener estadísticas por nivel de enriquecimiento
 * @returns {Promise<Object>} - Conteo por cada nivel
 */
async function getStatsByLevel() {
  try {
    // Contar establecimientos totales
    const totalEstablishments = await prismaGeo.establishment.count();

    // Contar establecimientos con contacto (phone/email/website)
    const totalContacts = await prismaGeo.establishment.count({
      where: {
        OR: [
          { phone: { not: null } },
          { email: { not: null } },
          { website: { not: null } },
        ],
      },
    });

    // Contar por nivel de enriquecimiento
    const enrichmentStats = await prismaGeo.establishmentEnrichment.groupBy({
      by: ["level"],
      _count: { id: true },
    });

    // Convertir a objeto
    const enrichmentByLevel = enrichmentStats.reduce((acc, stat) => {
      acc[stat.level] = stat._count.id;
      return acc;
    }, {});

    return {
      ESTABLISHMENT: totalEstablishments,
      CONTACT: totalContacts,
      PROSPECT: enrichmentByLevel.PROSPECT || 0,
      LEAD: enrichmentByLevel.LEAD || 0,
    };
  } catch (error) {
    logger.error("Error obteniendo estadísticas por nivel:", error);
    throw error;
  }
}

/**
 * Obtener enriquecimientos de un partner específico
 * @param {string} partnerId - ID del partner
 * @param {string|null} level - Filtrar por nivel
 * @returns {Promise<Array>} - Lista de enriquecimientos
 */
async function getEnrichmentsByPartner(partnerId, level = null) {
  try {
    const where = { enrichedBy: partnerId };
    if (level) {
      where.level = level;
    }

    const enrichments = await prismaGeo.establishmentEnrichment.findMany({
      where,
      include: {
        establishment: {
          select: {
            id: true,
            name: true,
            activityName: true,
            phone: true,
            email: true,
            website: true,
            latitude: true,
            longitude: true,
            municipalityName: true,
            stateName: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return enrichments;
  } catch (error) {
    logger.error("Error obteniendo enriquecimientos del partner:", error);
    throw error;
  }
}

/**
 * Eliminar un enriquecimiento
 * @param {string} establishmentId - ID del establecimiento
 * @param {string} partnerId - ID del partner (para validar permisos)
 * @returns {Promise<boolean>} - True si se eliminó
 */
async function deleteEnrichment(establishmentId, partnerId) {
  try {
    const enrichment = await prismaGeo.establishmentEnrichment.findUnique({
      where: { establishmentId },
    });

    if (!enrichment) {
      throw new Error("Enriquecimiento no encontrado");
    }

    // Solo el partner que creó puede eliminar (o un admin)
    if (enrichment.enrichedBy !== partnerId) {
      throw new Error("No tienes permisos para eliminar este enriquecimiento");
    }

    await prismaGeo.establishmentEnrichment.delete({
      where: { establishmentId },
    });

    logger.info(`Enriquecimiento eliminado para establecimiento ${establishmentId}`);
    return true;
  } catch (error) {
    logger.error("Error eliminando enriquecimiento:", error);
    throw error;
  }
}

module.exports = {
  calculateLevel,
  getEnrichmentByEstablishment,
  createOrUpdateEnrichment,
  bulkImportEnrichments,
  getStatsByLevel,
  getEnrichmentsByPartner,
  deleteEnrichment,
};

