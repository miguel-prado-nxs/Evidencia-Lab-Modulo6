/**
 * GeoInsights Service
 * Servicios para consultas geográficas de establecimientos DENUE
 * 
 * ARQUITECTURA:
 * - Mapa DB (prismaGeo): Establecimientos base INEGI/DENUE (800k+) - SOLO LECTURA
 * - Partners DB (prisma): Enriquecimientos, Prospectos, Leads - ESCRITURA/LECTURA
 * 
 * Esta separación evita duplicar los 800k+ establecimientos.
 */

const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");

/**
 * Buscar establecimientos dentro de un bounding box (viewport del mapa)
 * Lee de Mapa DB (prismaGeo) - datos base INEGI
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
 * Buscar establecimientos en un radio (metros) desde un punto central
 * Convierte el radio a un bounding box para consulta eficiente en Mapa DB
 */
async function findEstablishmentsInRadius(centerLat, centerLng, radiusMeters, filters = {}) {
  const latDelta = radiusMeters / 111000;
  const centerLatRadians = (centerLat * Math.PI) / 180;
  const lngDelta = radiusMeters / (111000 * Math.max(Math.cos(centerLatRadians), 0.000001));

  const bounds = {
    north: centerLat + latDelta,
    south: centerLat - latDelta,
    east: centerLng + lngDelta,
    west: centerLng - lngDelta,
  };

  const where = {
    latitude: { gte: bounds.south, lte: bounds.north },
    longitude: { gte: bounds.west, lte: bounds.east },
  };

  const activityCodes = Array.isArray(filters.activityCodes)
    ? filters.activityCodes
    : typeof filters.activityCode === "string"
      ? filters.activityCode.split(",")
      : [];

  if (activityCodes.length > 0) {
    const codes = activityCodes
      .map((code) => String(code).trim())
      .filter(Boolean);

    if (codes.length === 1) {
      where.activityCode = codes[0];
    } else if (codes.length > 1) {
      where.activityCode = { in: codes };
    }
  }

  if (filters.stateCode) where.stateCode = filters.stateCode;
  if (filters.municipalityCode) where.municipalityCode = filters.municipalityCode;

  if (Array.isArray(filters.employeeRanges) && filters.employeeRanges.length > 0) {
    where.employeeRange = { in: filters.employeeRanges };
  } else if (filters.employeeRange) {
    where.employeeRange = filters.employeeRange;
  }
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { activityName: { contains: filters.search, mode: "insensitive" } },
      { neighborhood: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  return prismaGeo.establishment.findMany({
    where,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      website: true,
      latitude: true,
      longitude: true,
      activityCode: true,
      activityName: true,
      employeeRange: true,
      stateCode: true,
      stateName: true,
      municipalityCode: true,
      municipalityName: true,
      neighborhood: true,
      postalCode: true,
    },
    take: 500,
  });
}

/**
 * Obtener un establecimiento por ID con todos los detalles
 * Combina datos de Mapa DB (establecimiento) con Partners DB (enriquecimiento/prospectos)
 * 
 * @param {string} id - UUID del establecimiento
 * @param {string|null} partnerId - ID del partner para filtrar enriquecimientos (opcional)
 * @returns {Object|null} Establecimiento con enriquecimiento filtrado por partner
 */
async function getEstablishmentById(id, partnerId = null) {
  // Obtener establecimiento base de Mapa DB
  const establishment = await prismaGeo.establishment.findUnique({
    where: { id },
  });

  if (!establishment) {
    return null;
  }

  // Construir query para enriquecimiento
  // Si partnerId está presente, solo devolver enriquecimiento si fue creado por ese partner
  let enrichmentPromise;
  if (partnerId) {
    enrichmentPromise = prisma.establishmentEnrichment.findFirst({
      where: {
        establishmentId: id,
        enrichedBy: partnerId,
      },
    });
  } else {
    // Sin partnerId, no devolver enriquecimiento (solo datos públicos)
    enrichmentPromise = Promise.resolve(null);
  }

  // Obtener enriquecimiento y prospectos de Partners DB
  const [enrichment, prospects] = await Promise.all([
    enrichmentPromise,
    prisma.leadProspect.findMany({
      where: { establishmentId: id },
      include: {
        partner: {
          select: {
            id: true,
            code: true,
            companyName: true,
          },
        },
      },
    }),
  ]);

  return {
    ...establishment,
    enrichment,
    prospects,
  };
}

/**
 * Verificar si un establecimiento ya fue agregado por algún usuario
 * Retorna true si existe al menos un enriquecimiento, false si no
 * @param {string} id - UUID del establecimiento
 * @returns {Promise<boolean>} true si está tomado, false si no
 */
async function checkIfEstablishmentTaken(id) {
  const enrichment = await prisma.establishmentEnrichment.findFirst({
    where: { establishmentId: id },
    select: { id: true },
  });

  return !!enrichment;
}

/**
 * Obtener datos clusterizados por zoom level
 * Lee de Mapa DB (prismaGeo)
 */
async function getClusteredData(bounds, zoom) {
  const { north, south, east, west } = bounds;

  let groupBy;
  if (zoom < 6) {
    groupBy = ["stateCode", "stateName"];
  } else if (zoom < 10) {
    groupBy = ["stateCode", "municipalityCode", "municipalityName"];
  } else {
    return getEstablishmentsInBounds(bounds, {}, { limit: 500 });
  }

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
 * Lee de Mapa DB (prismaGeo)
 */
async function getHeatmapData(bounds, filters = {}) {
  const { north, south, east, west } = bounds;

  const where = {
    latitude: { gte: south, lte: north },
    longitude: { gte: west, lte: east },
  };

  if (filters.activityCode) where.activityCode = filters.activityCode;
  if (filters.stateCode) where.stateCode = filters.stateCode;

  const points = await prismaGeo.establishment.findMany({
    where,
    select: {
      latitude: true,
      longitude: true,
      employeeRange: true,
    },
    take: 5000,
  });

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
 * Lee de Mapa DB (prismaGeo)
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
 * Combina Mapa DB (establecimientos) con Partners DB (prospectos)
 */
async function getZoneStats(stateCode = null, municipalityCode = null) {
  const where = {};
  if (stateCode) where.stateCode = stateCode;
  if (municipalityCode) where.municipalityCode = municipalityCode;

  // Estadísticas de establecimientos desde Mapa DB
  const [stats, sizeStats, total] = await Promise.all([
    prismaGeo.establishment.groupBy({
      by: ["activityCode", "activityName"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
    prismaGeo.establishment.groupBy({
      by: ["employeeRange"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prismaGeo.establishment.count({ where }),
  ]);

  // Obtener IDs de establecimientos en esta zona para filtrar prospectos
  let prospectsStats = [];
  if (stateCode || municipalityCode) {
    // Obtener IDs de establecimientos en la zona
    const establishmentIds = await prismaGeo.establishment.findMany({
      where,
      select: { id: true },
      take: 10000, // Limitar para performance
    });

    const ids = establishmentIds.map(e => e.id);

    if (ids.length > 0) {
      prospectsStats = await prisma.leadProspect.groupBy({
        by: ["status"],
        where: { establishmentId: { in: ids } },
        _count: { id: true },
      });
    }
  } else {
    // Sin filtro de zona, obtener todos los prospectos
    prospectsStats = await prisma.leadProspect.groupBy({
      by: ["status"],
      _count: { id: true },
    });
  }

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
 * Valida establecimiento en Mapa DB, guarda prospecto en Partners DB
 */
async function assignProspect(establishmentId, partnerId, notes = null) {
  // Verificar que el establecimiento existe en Mapa DB
  const establishment = await prismaGeo.establishment.findUnique({
    where: { id: establishmentId },
  });

  if (!establishment) {
    throw new Error("Establecimiento no encontrado");
  }

  // Verificar si ya existe un prospect en Partners DB (usa clee como establishmentId)
  let prospect = await prisma.leadProspect.findFirst({
    where: { establishmentId },
  });

  if (prospect) {
    if (prospect.status !== "AVAILABLE") {
      throw new Error("Este establecimiento ya está asignado o no está disponible");
    }

    // Actualizar prospect existente
    prospect = await prisma.leadProspect.update({
      where: { id: prospect.id },
      data: {
        partnerId,
        status: "ASSIGNED",
        assignedAt: new Date(),
        notes,
      },
    });
  } else {
    // Crear nuevo prospect en Partners DB (establishmentId = clee)
    prospect = await prisma.leadProspect.create({
      data: {
        establishmentId,
        partnerId,
        status: "ASSIGNED",
        assignedAt: new Date(),
        notes,
      },
    });
  }

  // Obtener datos del partner
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { id: true, code: true, companyName: true },
  });

  logger.info(`Prospect ${prospect.id} asignado a partner ${partnerId}`);

  return {
    ...prospect,
    establishment,
    partner,
  };
}

/**
 * Convertir prospect a lead
 * Lee establecimiento de Mapa DB, actualiza prospect y crea lead en Partners DB
 */
async function convertProspectToLead(prospectId, additionalData = {}) {
  logger.info(`[ConvertProspectToLead] Iniciando conversión de prospect ${prospectId}`);

  // Obtener prospect de Partners DB
  const prospect = await prisma.leadProspect.findUnique({
    where: { id: prospectId },
  });

  if (!prospect) {
    logger.error(`[ConvertProspectToLead] Prospect ${prospectId} no encontrado`);
    throw new Error("Prospect no encontrado");
  }

  logger.info(`[ConvertProspectToLead] Prospect encontrado: ${prospect.establishmentId}, status: ${prospect.status}`);

  if (!prospect.partnerId) {
    logger.error(`[ConvertProspectToLead] Prospect ${prospectId} no tiene partnerId`);
    throw new Error("El prospect debe estar asignado a un partner");
  }

  logger.info(`[ConvertProspectToLead] Buscando establishment con UUID: ${prospect.establishmentId}`);

  // Obtener datos del establecimiento de Mapa DB (por UUID)
  const establishment = await prismaGeo.establishment.findUnique({
    where: { id: prospect.establishmentId },
  });

  if (!establishment) {
    logger.error(`[ConvertProspectToLead] Establecimiento no encontrado. prospect.establishmentId (UUID): ${prospect.establishmentId}`);
    throw new Error("Establecimiento no encontrado");
  }

  logger.info(`[ConvertProspectToLead] Establishment encontrado: ${establishment.name}`);
  logger.info(`[ConvertProspectToLead] Creando lead...`);

  // Crear lead en Partners DB
  const lead = await prisma.lead.create({
    data: {
      partnerId: prospect.partnerId,
      businessName: establishment.name,
      contactName: additionalData.contactName || "Contacto Principal",
      email: establishment.email || additionalData.email || "",
      phone: establishment.phone || additionalData.phone,
      businessType: establishment.activityName,
      location: `${establishment.municipalityName}, ${establishment.stateName}`,
      interests: additionalData.interests || ["POS"],
      status: "NEW",
      notes: `Convertido desde prospect DENUE. ID Establecimiento: ${prospect.establishmentId}`,
    },
  });

  logger.info(`[ConvertProspectToLead] Lead creado: ${lead.id}, actualizando prospect...`);

  // Actualizar prospect en Partners DB
  const updatedProspect = await prisma.leadProspect.update({
    where: { id: prospectId },
    data: {
      status: "CONVERTED",
      convertedAt: new Date(),
      notes: `Convertido a Lead el ${new Date().toLocaleDateString('es-MX')}. Lead ID: ${lead.id}`,
    },
  });

  logger.info(`[ConvertProspectToLead] Prospect actualizado a status: ${updatedProspect.status}`);
  logger.info(`[ConvertProspectToLead] Conversión completada exitosamente. Prospect ${prospectId} -> Lead ${lead.id}`);

  return lead;
}

/**
 * Obtener prospects de un partner
 * Lee prospectos de Partners DB, enriquece con datos de establecimiento de Mapa DB
 */
async function getPartnerProspects(partnerId, status = null) {
  const where = { partnerId };
  if (status) where.status = status;

  // Obtener prospectos de Partners DB
  const prospects = await prisma.leadProspect.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  if (prospects.length === 0) {
    return [];
  }

  // Obtener IDs únicos de establecimientos (UUIDs)
  const establishmentIds = [...new Set(prospects.map(p => p.establishmentId))];

  // Obtener datos de establecimientos de Mapa DB (por UUID)
  const establishments = await prismaGeo.establishment.findMany({
    where: { id: { in: establishmentIds } },
    select: {
      id: true,
      clee: true,
      name: true,
      activityName: true,
      latitude: true,
      longitude: true,
      municipalityName: true,
      stateName: true,
      phone: true,
      email: true,
    },
  });

  // Crear mapa para lookup rápido (por UUID)
  const establishmentMap = establishments.reduce((acc, e) => {
    acc[e.id] = e;
    return acc;
  }, {});

  // Combinar datos
  return prospects.map(p => ({
    ...p,
    establishment: establishmentMap[p.establishmentId] || null,
  }));
}

/**
 * Buscar establecimientos por texto
 * Lee de Mapa DB (prismaGeo)
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
 * Lee de Mapa DB (prismaGeo)
 */
async function smartSearch(query, options = {}) {
  const { activityCode, limit = 10 } = options;

  if (!query || query.length < 2) {
    return { states: [], municipalities: [], establishments: [] };
  }

  const searchTerm = query.toLowerCase().trim();

  // Ejecutar todas las consultas en paralelo desde Mapa DB
  const [states, municipalities, establishments] = await Promise.all([
    prismaGeo.geoZone.findMany({
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
    }),
    prismaGeo.geoZone.findMany({
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
    }),
    prismaGeo.establishment.findMany({
      where: activityCode
        ? {
          activityCode,
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } },
            { activityName: { contains: searchTerm, mode: "insensitive" } },
          ],
        }
        : {
          OR: [
            { name: { contains: searchTerm, mode: "insensitive" } },
            { activityName: { contains: searchTerm, mode: "insensitive" } },
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
        stateCode: true,
        municipalityCode: true,
      },
      take: limit,
    }),
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
 * Lee de Mapa DB (prismaGeo)
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
 * Lee de Mapa DB (prismaGeo)
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
 * Lee de Mapa DB (prismaGeo)
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
 * Para ESTABLISHMENT/CONTACT: Lee de Mapa DB
 * Para PROSPECT/LEAD/CLIENT: Combina Mapa DB con Partners DB
 * 
 * IMPORTANTE: Para PROSPECT, LEAD y CLIENT se filtra por partnerId para que
 * cada usuario solo vea sus propios datos
 */
async function getEstablishmentsByLevel(bounds, level, filters = {}, options = {}) {
  const { north, south, east, west } = bounds;
  const { activityCode, stateCode, municipalityCode, search } = filters;
  const { limit = 500, offset = 0, partnerId = null } = options;

  // Para niveles que requieren enriquecimiento (PROSPECT, LEAD, CLIENT)
  if (level === "PROSPECT" || level === "LEAD" || level === "CLIENT") {
    // Construir filtro para enriquecimientos
    const enrichmentWhere = { level };

    // Si hay partnerId, filtrar solo los enriquecidos por ese partner
    if (partnerId) {
      enrichmentWhere.enrichedBy = partnerId;
    }

    const enrichments = await prisma.establishmentEnrichment.findMany({
      where: enrichmentWhere,
      select: {
        establishmentId: true,
        id: true,
        level: true,
        enrichedBy: true,
        decisionMakerName: true,
        decisionMakerPosition: true,
        decisionMakerPhone: true,
        decisionMakerWhatsApp: true,
        decisionMakerEmail: true,
        intent: true,
        fear: true,
        pain: true,
        desire: true,
        purchaseDate: true,
        productPurchased: true,
        purchaseAmount: true,
        clientSince: true,
        clientStatus: true,
        clientNotes: true,
      },
    });

    if (enrichments.length === 0) {
      return [];
    }

    // Obtener IDs de establecimientos enriquecidos
    const enrichedIds = enrichments.map(e => e.establishmentId);

    // Construir filtro para Mapa DB
    const where = {
      id: { in: enrichedIds },
      latitude: { gte: south, lte: north },
      longitude: { gte: west, lte: east },
    };

    if (activityCode) {
      const codes = activityCode.split(",").map(c => c.trim()).filter(Boolean);
      where.activityCode = codes.length === 1 ? codes[0] : { in: codes };
    }
    if (stateCode) where.stateCode = stateCode;
    if (municipalityCode) where.municipalityCode = municipalityCode;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { activityName: { contains: search, mode: "insensitive" } },
        { neighborhood: { contains: search, mode: "insensitive" } },
      ];
    }

    // Obtener establecimientos de Mapa DB
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

    // Crear mapa de enriquecimientos del usuario actual
    const enrichmentMap = enrichments.reduce((acc, e) => {
      acc[e.establishmentId] = e;
      return acc;
    }, {});

    // Para CONTACT y niveles superiores, verificar si están tomados por CUALQUIER usuario
    // Obtener todos los IDs de establecimientos que tienen ALGÚN enriquecimiento
    const establishmentIds = establishments.map(est => est.id);
    const allEnrichments = await prisma.establishmentEnrichment.findMany({
      where: {
        establishmentId: { in: establishmentIds },
      },
      select: {
        establishmentId: true,
      },
    });

    // Crear set de IDs tomados por cualquier usuario
    const takenByAnyUserSet = new Set(allEnrichments.map(e => e.establishmentId));

    // Combinar datos
    return establishments.map(est => ({
      ...est,
      enrichment: enrichmentMap[est.id] || null,
      isTakenByAnyUser: takenByAnyUserSet.has(est.id), // Flag para saber si alguien ya lo tiene
    }));
  }

  // Para ESTABLISHMENT y CONTACT: solo leer de Mapa DB
  const where = {
    latitude: { gte: south, lte: north },
    longitude: { gte: west, lte: east },
  };

  if (level === "CONTACT") {
    where.OR = [
      { phone: { not: null } },
      { email: { not: null } },
      { website: { not: null } },
    ];
  }

  if (activityCode) {
    const codes = activityCode.split(",").map(c => c.trim()).filter(Boolean);
    where.activityCode = codes.length === 1 ? codes[0] : { in: codes };
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

  /* 
   * Ejecutar consulta a Mapa DB
   */
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

  // Verificar cuáles están tomados por algún usuario
  const establishmentIds = establishments.map(est => est.id);
  const allEnrichments = await prisma.establishmentEnrichment.findMany({
    where: {
      establishmentId: { in: establishmentIds },
    },
    select: {
      establishmentId: true,
      enrichedBy: true,
    },
  });

  // Crear mapas
  const takenByAnyUserSet = new Set(allEnrichments.map(e => e.establishmentId));
  const enrichmentByUserMap = {};

  if (partnerId) {
    allEnrichments
      .filter(e => e.enrichedBy === partnerId)
      .forEach(e => {
        enrichmentByUserMap[e.establishmentId] = { level: "CONTACT" };
      });
  }

  // Retornar con flags
  return establishments.map(est => ({
    ...est,
    enrichment: enrichmentByUserMap[est.id] || null,
    isTakenByAnyUser: takenByAnyUserSet.has(est.id),
  }));
}

module.exports = {
  getEstablishmentsInBounds,
  findEstablishmentsInRadius,
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
  checkIfEstablishmentTaken,
};
