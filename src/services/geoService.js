/**
 * GeoInsights Service
 * Servicios para consultas geográficas de establecimientos DENUE
 */

const prismaGeo = require("../config/database-geo");
const prisma = require("../config/database");
const logger = require("../config/logger");

/**
 * Buscar establecimientos dentro de un bounding box (viewport del mapa)
 */
async function getEstablishmentsInBounds(bounds, filters = {}, options = {}) {
  const {
    north,
    south,
    east,
    west
  } = bounds;

  const {
    activityCode,
    stateCode,
    municipalityCode,
    employeeRange,
    search
  } = filters;

  const {
    limit = 1000,
    offset = 0
  } = options;

  const where = {
    latitude: { gte: south, lte: north },
    longitude: { gte: west, lte: east },
  };

  // Filtros opcionales
  // Soportar múltiples códigos de actividad separados por coma
  if (activityCode) {
    const codes = activityCode.split(",").map(c => c.trim()).filter(Boolean);
    if (codes.length === 1) {
      where.activityCode = codes[0];
    } else if (codes.length > 1) {
      where.activityCode = { in: codes };
    }
  }
  if (stateCode) where.stateCode = stateCode;
  if (municipalityCode) where.municipalityCode = municipalityCode;
  if (employeeRange) where.employeeRange = employeeRange;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { activityName: { contains: search, mode: "insensitive" } },
      { neighborhood: { contains: search, mode: "insensitive" } },
    ];
  }

  const establishments = await prismaGeo.establishment.findMany({
    where,
    take: limit,
    skip: offset,
    select: {
      id: true,
      name: true,
      activityCode: true,
      activityName: true,
      employeeRange: true,
      latitude: true,
      longitude: true,
      stateCode: true,
      stateName: true,
      municipalityCode: true,
      municipalityName: true,
      neighborhood: true,
      postalCode: true,
      phone: true,
      email: true,
      website: true,
    },
  });

  return establishments;
}

/**
 * Obtener un establecimiento por ID con todos los detalles
 */
async function getEstablishmentById(id) {
  return prismaGeo.establishment.findUnique({
    where: { id },
    include: {
      prospects: {
        include: {
          partner: {
            select: {
              id: true,
              code: true,
              companyName: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Obtener datos clusterizados por zoom level
 */
async function getClusteredData(bounds, zoom) {
  const { north, south, east, west } = bounds;

  // Determinar nivel de agrupación según zoom
  let groupBy;
  if (zoom < 6) {
    groupBy = ["stateCode", "stateName"];
  } else if (zoom < 10) {
    groupBy = ["stateCode", "municipalityCode", "municipalityName"];
  } else {
    // Zoom alto: devolver puntos individuales
    return getEstablishmentsInBounds(bounds, {}, { limit: 500 });
  }

  // Agrupar por región
  const clusters = await prismaGeo.establishment.groupBy({
    by: groupBy,
    where: {
      latitude: { gte: south, lte: north },
      longitude: { gte: west, lte: east },
    },
    _count: { id: true },
    _avg: { latitude: true, longitude: true },
  });

  return clusters.map(cluster => ({
    type: zoom < 6 ? "state" : "municipality",
    code: cluster.stateCode + (cluster.municipalityCode || ""),
    name: cluster.municipalityName || cluster.stateName,
    count: cluster._count.id,
    latitude: cluster._avg.latitude,
    longitude: cluster._avg.longitude,
  }));
}

/**
 * Obtener datos para heatmap
 */
async function getHeatmapData(bounds, filters = {}) {
  const { north, south, east, west } = bounds;

  const where = {
    latitude: { gte: south, lte: north },
    longitude: { gte: west, lte: east },
  };

  if (filters.activityCode) where.activityCode = filters.activityCode;
  if (filters.stateCode) where.stateCode = filters.stateCode;

  // Obtener puntos para el heatmap
  const points = await prismaGeo.establishment.findMany({
    where,
    select: {
      latitude: true,
      longitude: true,
      employeeRange: true,
    },
    take: 5000, // Límite para performance
  });

  // Asignar peso según tamaño del negocio
  return points.map(p => ({
    lat: p.latitude,
    lng: p.longitude,
    weight: getEmployeeWeight(p.employeeRange),
  }));
}

/**
 * Calcular peso basado en rango de empleados
 */
function getEmployeeWeight(range) {
  const weights = {
    "0 a 5 personas": 1,
    "6 a 10 personas": 2,
    "11 a 30 personas": 3,
    "31 a 50 personas": 4,
    "51 a 100 personas": 5,
    "101 a 250 personas": 6,
    "251 y más personas": 7,
  };
  return weights[range] || 1;
}

/**
 * Obtener zonas geográficas
 */
async function getGeoZones(type = null) {
  const where = type ? { type } : {};
  
  return prismaGeo.geoZone.findMany({
    where,
    orderBy: { totalEstablishments: "desc" },
  });
}

/**
 * Obtener estadísticas por zona
 */
async function getZoneStats(stateCode = null, municipalityCode = null) {
  const where = {};
  if (stateCode) where.stateCode = stateCode;
  if (municipalityCode) where.municipalityCode = municipalityCode;

  // Estadísticas de establecimientos
  const stats = await prismaGeo.establishment.groupBy({
    by: ["activityCode", "activityName"],
    where,
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });

  // Estadísticas por tamaño
  const sizeStats = await prismaGeo.establishment.groupBy({
    by: ["employeeRange"],
    where,
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  // Total
  const total = await prismaGeo.establishment.count({ where });

  // Prospects asignados vs disponibles
  const prospectsStats = await prismaGeo.leadProspect.groupBy({
    by: ["status"],
    where: {
      establishment: where,
    },
    _count: { id: true },
  });

  return {
    total,
    byActivity: stats.map(s => ({
      code: s.activityCode,
      name: s.activityName,
      count: s._count.id,
      percentage: ((s._count.id / total) * 100).toFixed(1),
    })),
    bySize: sizeStats.map(s => ({
      range: s.employeeRange || "No especificado",
      count: s._count.id,
      percentage: ((s._count.id / total) * 100).toFixed(1),
    })),
    prospects: prospectsStats.reduce((acc, s) => {
      acc[s.status.toLowerCase()] = s._count.id;
      return acc;
    }, {}),
  };
}

/**
 * Asignar prospect a un partner
 */
async function assignProspect(establishmentId, partnerId, notes = null) {
  // Verificar si ya existe un prospect
  let prospect = await prismaGeo.leadProspect.findFirst({
    where: { establishmentId },
  });

  if (prospect) {
    if (prospect.status !== "AVAILABLE") {
      throw new Error("Este establecimiento ya está asignado o no está disponible");
    }
    
    // Actualizar prospect existente
    prospect = await prismaGeo.leadProspect.update({
      where: { id: prospect.id },
      data: {
        partnerId,
        status: "ASSIGNED",
        assignedAt: new Date(),
        notes,
      },
      include: {
        establishment: true,
        partner: { select: { id: true, code: true, companyName: true } },
      },
    });
  } else {
    // Crear nuevo prospect
    prospect = await prismaGeo.leadProspect.create({
      data: {
        establishmentId,
        partnerId,
        status: "ASSIGNED",
        assignedAt: new Date(),
        notes,
      },
      include: {
        establishment: true,
        partner: { select: { id: true, code: true, companyName: true } },
      },
    });
  }

  logger.info(`Prospect ${prospect.id} asignado a partner ${partnerId}`);
  return prospect;
}

/**
 * Convertir prospect a lead
 */
async function convertProspectToLead(prospectId, additionalData = {}) {
  const prospect = await prismaGeo.leadProspect.findUnique({
    where: { id: prospectId },
    include: { establishment: true },
  });

  if (!prospect) {
    throw new Error("Prospect no encontrado");
  }

  if (!prospect.partnerId) {
    throw new Error("El prospect debe estar asignado a un partner");
  }

  // Crear lead desde el prospect
  const lead = await prisma.lead.create({
    data: {
      partnerId: prospect.partnerId,
      businessName: prospect.establishment.name,
      contactName: additionalData.contactName || "Contacto Principal",
      email: prospect.establishment.email || additionalData.email || "",
      phone: prospect.establishment.phone || additionalData.phone,
      businessType: prospect.establishment.activityName,
      location: `${prospect.establishment.municipalityName}, ${prospect.establishment.stateName}`,
      interests: additionalData.interests || ["POS"],
      status: "NEW",
      notes: `Convertido desde prospect DENUE. ID Establecimiento: ${prospect.establishmentId}`,
    },
  });

  // Actualizar prospect
  await prismaGeo.leadProspect.update({
    where: { id: prospectId },
    data: {
      status: "CONVERTED",
      convertedAt: new Date(),
    },
  });

  logger.info(`Prospect ${prospectId} convertido a lead ${lead.id}`);
  return lead;
}

/**
 * Obtener prospects de un partner
 */
async function getPartnerProspects(partnerId, status = null) {
  const where = { partnerId };
  if (status) where.status = status;

  return prismaGeo.leadProspect.findMany({
    where,
    include: {
      establishment: {
        select: {
          id: true,
          name: true,
          activityName: true,
          latitude: true,
          longitude: true,
          municipalityName: true,
          stateName: true,
          phone: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Buscar establecimientos por texto
 */
async function searchEstablishments(query, limit = 50) {
  return prismaGeo.establishment.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { activityName: { contains: query, mode: "insensitive" } },
        { municipalityName: { contains: query, mode: "insensitive" } },
        { stateName: { contains: query, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      activityName: true,
      latitude: true,
      longitude: true,
      municipalityName: true,
      stateName: true,
    },
    take: limit,
  });
}

/**
 * Búsqueda inteligente con resultados priorizados
 * Prioridad: 1. Estados, 2. Municipios, 3. Negocios
 */
async function smartSearch(query, options = {}) {
  const { activityCode, limit = 10 } = options;
  
  if (!query || query.length < 2) {
    return { states: [], municipalities: [], establishments: [] };
  }

  const searchTerm = query.toLowerCase().trim();

  // 1. Buscar estados que coincidan
  const statesQuery = prismaGeo.geoZone.findMany({
    where: {
      type: "STATE",
      name: { contains: searchTerm, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
      stateCode: true,
      totalEstablishments: true,
      centerLat: true,
      centerLng: true,
    },
    orderBy: { totalEstablishments: "desc" },
    take: 5,
  });

  // 2. Buscar municipios que coincidan
  const municipalitiesQuery = prismaGeo.geoZone.findMany({
    where: {
      type: "MUNICIPALITY",
      name: { contains: searchTerm, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
      stateCode: true,
      municipalityCode: true,
      totalEstablishments: true,
      centerLat: true,
      centerLng: true,
    },
    orderBy: { totalEstablishments: "desc" },
    take: 8,
  });

  // 3. Buscar negocios que coincidan
  const establishmentWhere = {
    OR: [
      { name: { contains: searchTerm, mode: "insensitive" } },
      { activityName: { contains: searchTerm, mode: "insensitive" } },
    ],
  };
  
  if (activityCode) {
    establishmentWhere.activityCode = activityCode;
  }

  const establishmentsQuery = prismaGeo.establishment.findMany({
    where: establishmentWhere,
    select: {
      id: true,
      name: true,
      activityName: true,
      latitude: true,
      longitude: true,
      municipalityName: true,
      stateName: true,
      stateCode: true,
      municipalityCode: true,
    },
    take: limit,
  });

  // Ejecutar todas las consultas en paralelo
  const [states, municipalities, establishments] = await Promise.all([
    statesQuery,
    municipalitiesQuery,
    establishmentsQuery,
  ]);

  // Enriquecer municipios con nombre del estado
  const enrichedMunicipalities = await Promise.all(
    municipalities.map(async (muni) => {
      const state = await prismaGeo.geoZone.findFirst({
        where: { type: "STATE", stateCode: muni.stateCode },
        select: { name: true },
      });
      return {
        ...muni,
        stateName: state?.name || "",
      };
    })
  );

  return {
    states: states.map(s => ({
      type: "state",
      id: s.id,
      name: s.name,
      code: s.stateCode,
      count: s.totalEstablishments,
      latitude: s.centerLat,
      longitude: s.centerLng,
      zoom: 7,
    })),
    municipalities: enrichedMunicipalities.map(m => ({
      type: "municipality",
      id: m.id,
      name: m.name,
      stateName: m.stateName,
      stateCode: m.stateCode,
      code: m.municipalityCode,
      count: m.totalEstablishments,
      latitude: m.centerLat,
      longitude: m.centerLng,
      zoom: 11,
    })),
    establishments: establishments.map(e => ({
      type: "establishment",
      id: e.id,
      name: e.name,
      activityName: e.activityName,
      municipalityName: e.municipalityName,
      stateName: e.stateName,
      latitude: e.latitude,
      longitude: e.longitude,
      zoom: 15,
    })),
  };
}

/**
 * Obtener categorías de actividad ordenadas por frecuencia
 */
async function getActivities() {
  const activities = await prismaGeo.establishment.groupBy({
    by: ["activityCode", "activityName"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 15,
  });

  return activities.map(a => ({
    code: a.activityCode,
    name: a.activityName,
    count: a._count.id,
  }));
}

/**
 * Obtener estados con conteo para dropdown
 */
async function getStatesWithCount() {
  return prismaGeo.geoZone.findMany({
    where: { type: "STATE" },
    select: {
      id: true,
      name: true,
      stateCode: true,
      totalEstablishments: true,
      centerLat: true,
      centerLng: true,
    },
    orderBy: { totalEstablishments: "desc" },
  });
}

/**
 * Obtener municipios de un estado
 */
async function getMunicipalitiesByState(stateCode) {
  return prismaGeo.geoZone.findMany({
    where: { 
      type: "MUNICIPALITY",
      stateCode: stateCode,
    },
    select: {
      id: true,
      name: true,
      municipalityCode: true,
      totalEstablishments: true,
      centerLat: true,
      centerLng: true,
    },
    orderBy: { totalEstablishments: "desc" },
  });
}

/**
 * Obtener establecimientos filtrados por nivel de enriquecimiento
 * Niveles: ESTABLISHMENT (todos), CONTACT (con datos de contacto), PROSPECT (con tomador de decisiones), LEAD (con cualificación), CLIENT (clientes)
 */
async function getEstablishmentsByLevel(bounds, level, filters = {}, options = {}) {
  const { north, south, east, west } = bounds;
  const { activityCode, stateCode, municipalityCode, search } = filters;
  const { limit = 500, offset = 0 } = options;

  // Construir where base con bounds
  const where = {
    latitude: { gte: south, lte: north },
    longitude: { gte: west, lte: east },
  };

  // Filtrar según el nivel
  switch (level) {
    case "CONTACT":
      // Establecimientos con al menos un método de contacto
      where.OR = [
        { phone: { not: null, not: "" } },
        { email: { not: null, not: "" } },
        { website: { not: null, not: "" } },
      ];
      break;

    case "PROSPECT":
      // Establecimientos con enriquecimiento nivel PROSPECT, LEAD o CLIENT
      where.enrichment = {
        level: { in: ["PROSPECT", "LEAD", "CLIENT"] },
      };
      break;

    case "LEAD":
      // Establecimientos con enriquecimiento nivel LEAD o CLIENT
      where.enrichment = {
        level: { in: ["LEAD", "CLIENT"] },
      };
      break;

    case "CLIENT":
      // Solo establecimientos con enriquecimiento nivel CLIENT
      where.enrichment = {
        level: "CLIENT",
      };
      break;

    // ESTABLISHMENT: todos (no se agrega filtro adicional)
  }

  // Filtros opcionales
  if (activityCode) {
    const codes = activityCode.split(",").map(c => c.trim()).filter(Boolean);
    if (codes.length === 1) {
      where.activityCode = codes[0];
    } else if (codes.length > 1) {
      where.activityCode = { in: codes };
    }
  }
  if (stateCode) where.stateCode = stateCode;
  if (municipalityCode) where.municipalityCode = municipalityCode;
  if (search) {
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { activityName: { contains: search, mode: "insensitive" } },
          { neighborhood: { contains: search, mode: "insensitive" } },
        ],
      },
    ];
  }

  // Incluir enrichment para niveles PROSPECT, LEAD y CLIENT
  const includeEnrichment = level === "PROSPECT" || level === "LEAD" || level === "CLIENT";

  const establishments = await prismaGeo.establishment.findMany({
    where,
    take: limit,
    skip: offset,
    select: {
      id: true,
      name: true,
      activityCode: true,
      activityName: true,
      employeeRange: true,
      latitude: true,
      longitude: true,
      stateCode: true,
      stateName: true,
      municipalityCode: true,
      municipalityName: true,
      neighborhood: true,
      postalCode: true,
      phone: true,
      email: true,
      website: true,
      enrichment: includeEnrichment ? {
        select: {
          id: true,
          level: true,
          decisionMakerName: true,
          decisionMakerPosition: true,
          decisionMakerPhone: true,
          decisionMakerWhatsApp: true,
          decisionMakerEmail: true,
          intent: true,
          fear: true,
          pain: true,
          desire: true,
          // Campos de cliente
          purchaseDate: true,
          productPurchased: true,
          purchaseAmount: true,
          clientSince: true,
          clientStatus: true,
          clientNotes: true,
        },
      } : false,
    },
  });

  return establishments;
}

module.exports = {
  getEstablishmentsInBounds,
  getEstablishmentById,
  getClusteredData,
  getHeatmapData,
  getGeoZones,
  getZoneStats,
  assignProspect,
  convertProspectToLead,
  getPartnerProspects,
  searchEstablishments,
  smartSearch,
  getActivities,
  getStatesWithCount,
  getMunicipalitiesByState,
  getEstablishmentsByLevel,
};
