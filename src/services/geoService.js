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
  if (activityCode) where.activityCode = activityCode;
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
};
