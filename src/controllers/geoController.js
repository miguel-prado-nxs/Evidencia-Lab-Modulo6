/**
 * GeoInsights Controller
 * Controladores para la API de datos geográficos
 */

const geoService = require("../services/geoService");
const logger = require("../config/logger");

/**
 * GET /api/v1/geo/establishments
 * Obtener establecimientos en un área geográfica
 */
async function getEstablishments(req, res, next) {
  try {
    const { north, south, east, west, activity, state, municipality, employees, search, limit, offset } = req.query;

    // Validar bounds requeridos
    if (!north || !south || !east || !west) {
      return res.status(400).json({
        success: false,
        error: "Se requieren los parámetros: north, south, east, west",
      });
    }

    const bounds = {
      north: parseFloat(north),
      south: parseFloat(south),
      east: parseFloat(east),
      west: parseFloat(west),
    };

    const filters = {
      activityCode: activity,
      stateCode: state,
      municipalityCode: municipality,
      employeeRange: employees,
      search,
    };

    const options = {
      limit: limit ? parseInt(limit) : 1000,
      offset: offset ? parseInt(offset) : 0,
    };

    const establishments = await geoService.getEstablishmentsInBounds(bounds, filters, options);

    res.json({
      success: true,
      data: establishments,
      count: establishments.length,
      bounds,
    });
  } catch (error) {
    logger.error("Error en getEstablishments:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/establishments/:id
 * Obtener detalle de un establecimiento
 */
async function getEstablishmentById(req, res, next) {
  try {
    const { id } = req.params;

    const establishment = await geoService.getEstablishmentById(id);

    if (!establishment) {
      return res.status(404).json({
        success: false,
        error: "Establecimiento no encontrado",
      });
    }

    res.json({
      success: true,
      data: establishment,
    });
  } catch (error) {
    logger.error("Error en getEstablishmentById:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/clusters
 * Obtener datos clusterizados para el mapa
 */
async function getClusters(req, res, next) {
  try {
    const { north, south, east, west, zoom } = req.query;

    if (!north || !south || !east || !west || !zoom) {
      return res.status(400).json({
        success: false,
        error: "Se requieren: north, south, east, west, zoom",
      });
    }

    const bounds = {
      north: parseFloat(north),
      south: parseFloat(south),
      east: parseFloat(east),
      west: parseFloat(west),
    };

    const clusters = await geoService.getClusteredData(bounds, parseInt(zoom));

    res.json({
      success: true,
      data: clusters,
      count: clusters.length,
      zoom: parseInt(zoom),
    });
  } catch (error) {
    logger.error("Error en getClusters:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/heatmap
 * Obtener datos para heatmap
 */
async function getHeatmap(req, res, next) {
  try {
    const { north, south, east, west, activity, state } = req.query;

    if (!north || !south || !east || !west) {
      return res.status(400).json({
        success: false,
        error: "Se requieren: north, south, east, west",
      });
    }

    const bounds = {
      north: parseFloat(north),
      south: parseFloat(south),
      east: parseFloat(east),
      west: parseFloat(west),
    };

    const filters = {
      activityCode: activity,
      stateCode: state,
    };

    const heatmapData = await geoService.getHeatmapData(bounds, filters);

    res.json({
      success: true,
      data: heatmapData,
      count: heatmapData.length,
    });
  } catch (error) {
    logger.error("Error en getHeatmap:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/zones
 * Obtener zonas geográficas
 */
async function getZones(req, res, next) {
  try {
    const { type } = req.query;

    const zones = await geoService.getGeoZones(type);

    res.json({
      success: true,
      data: zones,
      count: zones.length,
    });
  } catch (error) {
    logger.error("Error en getZones:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/stats
 * Obtener estadísticas por zona
 */
async function getStats(req, res, next) {
  try {
    const { state, municipality } = req.query;

    const stats = await geoService.getZoneStats(state, municipality);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error en getStats:", error);
    next(error);
  }
}

/**
 * POST /api/v1/geo/prospects/assign
 * Asignar un establecimiento como prospect a un partner
 */
async function assignProspect(req, res, next) {
  try {
    const { establishmentId, notes } = req.body;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "Solo partners pueden asignar prospects",
      });
    }

    if (!establishmentId) {
      return res.status(400).json({
        success: false,
        error: "Se requiere establishmentId",
      });
    }

    const prospect = await geoService.assignProspect(establishmentId, partnerId, notes);

    res.status(201).json({
      success: true,
      data: prospect,
      message: "Prospect asignado correctamente",
    });
  } catch (error) {
    logger.error("Error en assignProspect:", error);
    if (error.message.includes("ya está asignado")) {
      return res.status(409).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
}

/**
 * POST /api/v1/geo/prospects/:id/convert
 * Convertir un prospect a lead
 */
async function convertProspect(req, res, next) {
  try {
    const { id } = req.params;
    const { contactName, email, phone, interests } = req.body;

    const lead = await geoService.convertProspectToLead(id, {
      contactName,
      email,
      phone,
      interests,
    });

    res.json({
      success: true,
      data: lead,
      message: "Prospect convertido a lead correctamente",
    });
  } catch (error) {
    logger.error("Error en convertProspect:", error);
    if (error.message.includes("no encontrado") || error.message.includes("debe estar asignado")) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
}

/**
 * GET /api/v1/geo/prospects
 * Obtener prospects del partner autenticado
 */
async function getMyProspects(req, res, next) {
  try {
    const partnerId = req.user.partner?.id;
    const { status } = req.query;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "Solo partners pueden ver sus prospects",
      });
    }

    const prospects = await geoService.getPartnerProspects(partnerId, status);

    res.json({
      success: true,
      data: prospects,
      count: prospects.length,
    });
  } catch (error) {
    logger.error("Error en getMyProspects:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/search
 * Buscar establecimientos por texto
 */
async function searchEstablishments(req, res, next) {
  try {
    const { q, limit } = req.query;

    if (!q || q.length < 3) {
      return res.status(400).json({
        success: false,
        error: "Se requiere un término de búsqueda de al menos 3 caracteres",
      });
    }

    const results = await geoService.searchEstablishments(q, limit ? parseInt(limit) : 50);

    res.json({
      success: true,
      data: results,
      count: results.length,
    });
  } catch (error) {
    logger.error("Error en searchEstablishments:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/smart-search
 * Búsqueda inteligente con resultados priorizados (estados > municipios > negocios)
 */
async function smartSearch(req, res, next) {
  try {
    const { q, activity, limit } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: { states: [], municipalities: [], establishments: [] },
        count: 0,
      });
    }

    const options = {
      activityCode: activity,
      limit: limit ? parseInt(limit) : 10,
    };

    const results = await geoService.smartSearch(q, options);

    const totalCount = 
      results.states.length + 
      results.municipalities.length + 
      results.establishments.length;

    res.json({
      success: true,
      data: results,
      count: totalCount,
    });
  } catch (error) {
    logger.error("Error en smartSearch:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/activities
 * Obtener categorías de actividad ordenadas por frecuencia
 */
async function getActivities(req, res, next) {
  try {
    const activities = await geoService.getActivities();

    res.json({
      success: true,
      data: activities,
      count: activities.length,
    });
  } catch (error) {
    logger.error("Error en getActivities:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/states
 * Obtener lista de estados con conteo de establecimientos
 */
async function getStates(req, res, next) {
  try {
    const states = await geoService.getStatesWithCount();

    res.json({
      success: true,
      data: states,
      count: states.length,
    });
  } catch (error) {
    logger.error("Error en getStates:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/states/:stateCode/municipalities
 * Obtener municipios de un estado
 */
async function getMunicipalities(req, res, next) {
  try {
    const { stateCode } = req.params;

    if (!stateCode) {
      return res.status(400).json({
        success: false,
        error: "Se requiere el código del estado",
      });
    }

    const municipalities = await geoService.getMunicipalitiesByState(stateCode);

    res.json({
      success: true,
      data: municipalities,
      count: municipalities.length,
    });
  } catch (error) {
    logger.error("Error en getMunicipalities:", error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/establishments/level/:level
 * Obtener establecimientos filtrados por nivel de enriquecimiento
 * Niveles: ESTABLISHMENT, CONTACT, PROSPECT, LEAD, CLIENT
 */
async function getEstablishmentsByLevel(req, res, next) {
  try {
    const { level } = req.params;
    const { north, south, east, west, activity, state, municipality, search, limit, offset } = req.query;

    // Validar nivel
    const validLevels = ["ESTABLISHMENT", "CONTACT", "PROSPECT", "LEAD", "CLIENT"];
    if (!validLevels.includes(level)) {
      return res.status(400).json({
        success: false,
        error: `Nivel inválido. Debe ser uno de: ${validLevels.join(", ")}`,
      });
    }

    // Validar bounds requeridos
    if (!north || !south || !east || !west) {
      return res.status(400).json({
        success: false,
        error: "Se requieren los parámetros: north, south, east, west",
      });
    }

    const bounds = {
      north: parseFloat(north),
      south: parseFloat(south),
      east: parseFloat(east),
      west: parseFloat(west),
    };

    const filters = {
      activityCode: activity,
      stateCode: state,
      municipalityCode: municipality,
      search,
    };

    const options = {
      limit: limit ? parseInt(limit) : 500,
      offset: offset ? parseInt(offset) : 0,
    };

    const establishments = await geoService.getEstablishmentsByLevel(bounds, level, filters, options);

    res.json({
      success: true,
      data: establishments,
      count: establishments.length,
      level,
      bounds,
    });
  } catch (error) {
    logger.error("Error en getEstablishmentsByLevel:", error);
    next(error);
  }
}

module.exports = {
  getEstablishments,
  getEstablishmentById,
  getClusters,
  getHeatmap,
  getZones,
  getStats,
  assignProspect,
  convertProspect,
  getMyProspects,
  searchEstablishments,
  smartSearch,
  getActivities,
  getStates,
  getMunicipalities,
  getEstablishmentsByLevel,
};
