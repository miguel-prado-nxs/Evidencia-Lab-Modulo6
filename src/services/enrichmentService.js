/**
 * Enrichment Service
 * Servicios para enriquecimiento de establecimientos con información adicional
 * Gestiona los niveles: ESTABLISHMENT -> CONTACT -> PROSPECT -> LEAD -> CLIENT
 *
 * ARQUITECTURA:
 * - Mapa DB (prismaGeo): Establecimientos base INEGI/DENUE (800k+) - SOLO LECTURA
 * - Partners DB (prisma): Enriquecimientos - ESCRITURA/LECTURA
 */

const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");
const geoService = require("./geoService");
const leadService = require("./leadService");
const { emitLevelChanged, emitEnrichmentUpdated } = require("../config/sseEvents");
const { enqueueSync } = require("./twenty/twentySyncService");

/**
 * Calcular el nivel de un establecimiento basado en sus datos
 * @param {Object} establishment - Datos del establecimiento DENUE
 * @param {Object|null} enrichment - Datos de enriquecimiento adicionales
 * @returns {string} - Nivel: ESTABLISHMENT | CONTACT | PROSPECT | LEAD | CLIENT
 */
function calculateLevel(establishment, enrichment = null) {
  // Nivel CLIENT: tiene fecha de compra y producto adquirido
  if (enrichment?.purchaseDate && enrichment?.productPurchased) {
    return "CLIENT";
  }

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
 * Combina datos de Mapa DB (establecimiento) con Partners DB (enriquecimiento)
 */
async function getEnrichmentByEstablishment(establishmentId) {
  try {
    // Obtener enriquecimiento de Partners DB
    const enrichment = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId },
    });

    if (!enrichment) {
      return null;
    }

    // Obtener datos del establecimiento de Mapa DB
    const establishment = await prismaGeo.establishment.findUnique({
      where: { id: establishmentId },
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
    });

    return {
      ...enrichment,
      establishment,
    };
  } catch (error) {
    logger.error("Error obteniendo enriquecimiento:", error);
    throw error;
  }
}

/**
 * Crear o actualizar el enriquecimiento de un establecimiento
 * Valida establecimiento en Mapa DB, guarda enriquecimiento en Partners DB
 * IMPORTANTE: Preserva datos existentes si no se envían nuevos valores
 */
async function createOrUpdateEnrichment(establishmentId, data, partnerId) {
  try {
    // El establishmentId que llega es el UUID del establishment
    // Obtener el establecimiento de Mapa DB para validar y calcular nivel
    const establishment = await prismaGeo.establishment.findFirst({
      where: { id: establishmentId },
      select: {
        id: true,
        clee: true,
        name: true,
        phone: true,
        email: true,
        website: true,
        activityCode: true,
        activityName: true,
        employeeRange: true,
        latitude: true,
        longitude: true,
        municipalityName: true,
        stateName: true,
      },
    });

    if (!establishment) {
      throw new Error("Establecimiento no encontrado");
    }

    // Usar el UUID como establishmentId para la tabla establishmentEnrichment
    const estabId = establishment.id;

    // Buscar si ya existe un enriquecimiento en Partners DB
    const existing = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId: estabId },
    });

    // Preparar datos de enriquecimiento preservando los existentes
    // Solo actualiza si el valor viene definido (no undefined)
    const enrichmentData = {
      // Datos de prospecto (tomador de decisiones)
      decisionMakerName:
        data.decisionMakerName !== undefined
          ? data.decisionMakerName || null
          : existing?.decisionMakerName || null,
      decisionMakerPosition:
        data.decisionMakerPosition !== undefined
          ? data.decisionMakerPosition || null
          : existing?.decisionMakerPosition || null,
      decisionMakerPhone:
        data.decisionMakerPhone !== undefined
          ? data.decisionMakerPhone || null
          : existing?.decisionMakerPhone || null,
      decisionMakerWhatsApp:
        data.decisionMakerWhatsApp !== undefined
          ? data.decisionMakerWhatsApp || null
          : existing?.decisionMakerWhatsApp || null,
      decisionMakerEmail:
        data.decisionMakerEmail !== undefined
          ? data.decisionMakerEmail || null
          : existing?.decisionMakerEmail || null,
      // Datos de lead (cualificación)
      intent:
        data.intent !== undefined
          ? data.intent || null
          : existing?.intent || null,
      fear:
        data.fear !== undefined ? data.fear || null : existing?.fear || null,
      pain:
        data.pain !== undefined ? data.pain || null : existing?.pain || null,
      desire:
        data.desire !== undefined
          ? data.desire || null
          : existing?.desire || null,
      // Datos de cliente
      purchaseDate:
        data.purchaseDate !== undefined
          ? data.purchaseDate
            ? new Date(data.purchaseDate)
            : null
          : existing?.purchaseDate || null,
      productPurchased:
        data.productPurchased !== undefined
          ? data.productPurchased || null
          : existing?.productPurchased || null,
      purchaseAmount:
        data.purchaseAmount !== undefined
          ? data.purchaseAmount
            ? parseFloat(data.purchaseAmount)
            : null
          : existing?.purchaseAmount || null,
      clientSince:
        data.clientSince !== undefined
          ? data.clientSince
            ? new Date(data.clientSince)
            : null
          : existing?.clientSince || null,
      clientStatus:
        data.clientStatus !== undefined
          ? data.clientStatus || null
          : existing?.clientStatus || null,
      clientNotes:
        data.clientNotes !== undefined
          ? data.clientNotes || null
          : existing?.clientNotes || null,
      // Metadata
      lastUpdatedBy: partnerId,
      // Datos del establecimiento para Orchestrator (evita query a BD 801k)
      establishmentData: {
        clee: establishment.clee || null, // IMPORTANTE: Incluir clee para Twenty sync
        name: establishment.name || null,
        phone: establishment.phone || null,
        email: establishment.email || null,
        employee_range: establishment.employeeRange || null,
        activity_code: establishment.activityCode || null,
        activity_name: establishment.activityName || null,
        latitude: establishment.latitude?.toString() || null,
        longitude: establishment.longitude?.toString() || null,
        state_name: establishment.stateName || null,
        municipality_name: establishment.municipalityName || null,
      },
    };

    // Calcular nivel basado en los datos combinados
    const level = calculateLevel(establishment, enrichmentData);
    enrichmentData.level = level;

    // Guardar nivel anterior para detectar cambios
    const previousLevel = existing?.level || null;

    let enrichment;

    if (existing) {
      // Actualizar existente
      enrichment = await prisma.establishmentEnrichment.update({
        where: { establishmentId: estabId },
        data: enrichmentData,
      });
      logger.info(
        `Enriquecimiento actualizado para establecimiento ${estabId} - Nivel: ${level}`
      );

      // Emitir evento SSE si el nivel cambió
      if (previousLevel && previousLevel !== level) {
        emitLevelChanged({
          partnerId: existing.enrichedBy || partnerId,
          establishmentId: estabId,
          previousLevel,
          newLevel: level,
          enrichment: {
            id: enrichment.id,
            level,
            decisionMakerName: enrichmentData.decisionMakerName,
            updatedAt: enrichment.updatedAt,
          },
        });
      } else {
        // Emitir evento de actualización sin cambio de nivel
        emitEnrichmentUpdated({
          partnerId: existing.enrichedBy || partnerId,
          establishmentId: estabId,
          previousLevel,
          newLevel: level,
          enrichment: {
            id: enrichment.id,
            level,
            decisionMakerName: enrichmentData.decisionMakerName,
            updatedAt: enrichment.updatedAt,
          },
        });
      }
    } else {
      // Crear nuevo en Partners DB
      enrichment = await prisma.establishmentEnrichment.create({
        data: {
          ...enrichmentData,
          establishmentId: estabId,
          enrichedBy: partnerId,
          enrichedAt: new Date(),
        },
      });
      logger.info(
        `Enriquecimiento creado para establecimiento ${estabId} - Nivel: ${level}`
      );

      // Emitir evento de nuevo enriquecimiento
      emitEnrichmentUpdated({
        partnerId,
        establishmentId: estabId,
        previousLevel: null,
        newLevel: level,
        enrichment: {
          id: enrichment.id,
          level,
          decisionMakerName: enrichmentData.decisionMakerName,
          updatedAt: enrichment.updatedAt,
        },
      });
    }

    // Auto-promoción según datos proporcionados (sin cambios de esquema)
    // IMPORTANTE: Esta lógica se ejecuta ANTES del sync con Twenty para garantizar
    // que los registros (leadProspect, lead) existan antes de sincronizar
    
    // 1) Si hay datos de tomador de decisiones -> asegurar Prospect asignado al partner
    const hasDecisionMaker = (
      !!enrichmentData.decisionMakerName ||
      !!enrichmentData.decisionMakerPhone ||
      !!enrichmentData.decisionMakerWhatsApp
    );

    // 2) Si hay datos de cualificación (IFPD) -> asegurar Lead creado para el partner
    const hasQualification = (
      !!enrichmentData.intent ||
      !!enrichmentData.fear ||
      !!enrichmentData.pain ||
      !!enrichmentData.desire
    );

    // 3) Si hay datos de cliente -> marcar lead como CLIENT
    const hasClientInfo = (
      !!enrichmentData.purchaseDate ||
      !!enrichmentData.productPurchased ||
      !!enrichmentData.clientStatus
    );

    // Ejecutar promociones de manera segura y mínima
    let ensuredProspect = null;
    logger.info(`[Auto-Promoción] hasDecisionMaker=${hasDecisionMaker}, hasQualification=${hasQualification}, hasClientInfo=${hasClientInfo}, partnerId=${partnerId}`);
    
    if (hasDecisionMaker && partnerId) {
      try {
        // Verificar prospect existente para este establecimiento
        ensuredProspect = await prisma.leadProspect.findFirst({
          where: { establishmentId: estabId },
        });
        
        logger.info(`[Auto-Promoción] Prospect existente: ${ensuredProspect ? `id=${ensuredProspect.id}, status=${ensuredProspect.status}, partnerId=${ensuredProspect.partnerId}` : 'NO EXISTE'}`);

        if (!ensuredProspect || ensuredProspect.status === "AVAILABLE") {
          // Asignar prospect al partner
          ensuredProspect = await geoService.assignProspect(estabId, partnerId, "Auto-asignado por enriquecimiento (Tomador)");
          logger.info(`[Auto-Promoción] Prospect CREADO/ASIGNADO: id=${ensuredProspect.id}, status=${ensuredProspect.status} para est ${estabId} y partner ${partnerId}`);
        } else {
          logger.info(`[Auto-Promoción] Prospect ya existe y no está AVAILABLE, no se reasigna`);
        }
      } catch (promoErr) {
        logger.warn("[Auto-Promoción] (Prospect) falló:", promoErr.message);
      }
    }

    if (hasQualification && partnerId) {
      try {
        // Asegurar que exista un prospect asignado; si no, crear y asignar primero
        if (!ensuredProspect) {
          ensuredProspect = await prisma.leadProspect.findFirst({ where: { establishmentId: estabId } });
          if (!ensuredProspect) {
            ensuredProspect = await geoService.assignProspect(estabId, partnerId, "Auto-asignado por enriquecimiento (IFPD)");
          }
        }

        // Convertir a lead si aún no está convertido
        if (ensuredProspect && ensuredProspect.status !== "CONVERTED") {
          await geoService.convertProspectToLead(ensuredProspect.id, {
            contactName: enrichmentData.decisionMakerName || "Contacto",
            email: establishment.email || enrichmentData.decisionMakerEmail || undefined,
            phone: establishment.phone || enrichmentData.decisionMakerPhone || enrichmentData.decisionMakerWhatsApp || undefined,
            interests: ["POS"],
          });
          logger.info(`[Auto-Promoción] Prospect ${ensuredProspect.id} convertido a Lead por cualificación`);
        }
      } catch (promoErr) {
        logger.warn("[Auto-Promoción] (Lead) falló:", promoErr);
      }
    }

    if (hasClientInfo && partnerId) {
      try {
        // Buscar lead más reciente del partner para este establecimiento (si existe relación)
        const recentLead = await prisma.lead.findFirst({
          where: { partnerId },
          orderBy: { createdAt: "desc" },
        });
        if (recentLead) {
          await leadService.updateLeadStatus(recentLead.id, "WON", "Marcado como cliente (WON) por enriquecimiento");
          logger.info(`[Auto-Promoción] Lead ${recentLead.id} marcado como WON/cliente`);
        }
      } catch (promoErr) {
        logger.warn("[Auto-Promoción] (Client) falló:", promoErr);
      }
    }

    // Log de evento de enriquecimiento (non-blocking)
    if (partnerId) {
      logEnrichmentEvent({
        establishmentId: estabId,
        source: 'PARTNER_PORTAL',
        levelReached: level,
        enrichmentSnapshot: data,
        enrichedBy: partnerId,
        enrichedByType: 'PARTNER',
      }).catch(() => {});
    }

    // Encolar sincronizacion con Twenty CRM (non-blocking)
    // Se ejecuta DESPUÉS de la auto-promoción para garantizar que los registros existan
    if (partnerId) {
      let syncReason;
      if (previousLevel && previousLevel !== level) {
        // Cambio de nivel
        syncReason = `${previousLevel}_TO_${level}`;
      } else if (existing) {
        // Actualización de datos sin cambio de nivel
        syncReason = `UPDATE_${level}`;
      } else {
        // Nuevo enriquecimiento
        syncReason = `NEW_${level}`;
      }
      
      enqueueSync({
        establishmentId: estabId,
        partnerId,
        reason: syncReason,
      }).catch((err) => {
        logger.warn("[EnrichmentService] Error encolando sync (no critico)", { error: err.message });
      });
    }

    // Retornar con datos del establecimiento
    return {
      ...enrichment,
      establishment,
    };
  } catch (error) {
    logger.error("Error creando/actualizando enriquecimiento:", error);
    throw error;
  }
}

/**
 * Importar enriquecimientos en lote desde CSV/JSON
 * Valida establecimientos en Mapa DB, guarda en Partners DB
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
      if (!item.establishmentId) {
        results.failed++;
        results.errors.push({
          item,
          error: "establishmentId es requerido",
        });
        continue;
      }

      // Verificar que el establecimiento existe en Mapa DB
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

  logger.info(
    `Importación masiva completada: ${results.success}/${results.total} exitosos`
  );
  return results;
}

/**
 * Obtener estadísticas por nivel de enriquecimiento
 * Combina estadísticas de Mapa DB (totales) con Partners DB
 * 
 * ARQUITECTURA DE CONTEOS:
 * - ESTABLISHMENT: Total de establecimientos en Mapa DB (siempre global)
 * - CONTACT: Establecimientos con phone/email/website en Mapa DB (siempre global)
 * - PROSPECT: Conteo desde establishment_enrichments con level=PROSPECT (filtrado por partner si autenticado)
 * - LEAD: Conteo desde establishment_enrichments con level=LEAD (filtrado por partner si autenticado)
 * - CLIENT: Conteo desde establishment_enrichments con level=CLIENT (filtrado por partner si autenticado)
 * 
 * @param {string|null} partnerId - ID del partner para filtrar (opcional)
 */
async function getStatsByLevel(partnerId = null) {
  try {
    // Contar establecimientos totales de Mapa DB (siempre global)
    const totalEstablishments = await prismaGeo.establishment.count();

    // Contar establecimientos con contacto (phone/email/website) de Mapa DB (siempre global)
    const totalContacts = await prismaGeo.establishment.count({
      where: {
        OR: [
          { phone: { not: null } },
          { email: { not: null } },
          { website: { not: null } },
        ],
      },
    });

    // Construir filtro base para niveles PROSPECT, LEAD, CLIENT
    const enrichmentWhereBase = partnerId ? { enrichedBy: partnerId } : {};

    // Contar prospectos desde enrichments con level=PROSPECT
    const totalProspects = await prisma.establishmentEnrichment.count({
      where: { ...enrichmentWhereBase, level: "PROSPECT" },
    });

    // Contar leads desde enrichments con level=LEAD
    const totalLeads = await prisma.establishmentEnrichment.count({
      where: { ...enrichmentWhereBase, level: "LEAD" },
    });

    // Contar clientes desde enrichments con level=CLIENT
    const totalClients = await prisma.establishmentEnrichment.count({
      where: { ...enrichmentWhereBase, level: "CLIENT" },
    });

    return {
      ESTABLISHMENT: totalEstablishments,
      CONTACT: totalContacts,
      PROSPECT: totalProspects,
      LEAD: totalLeads,
      CLIENT: totalClients,
    };
  } catch (error) {
    logger.error("Error obteniendo estadísticas por nivel:", error);
    throw error;
  }
}

/**
 * Obtener estadísticas por nivel para un partner específico
 * Lee de Partners DB
 * 
 * ARQUITECTURA SIMPLIFICADA - EstablishmentEnrichment es la fuente de verdad:
 * - CONTACT: enrichments con level=CONTACT
 * - PROSPECT: lead_prospects asignados EXCLUYENDO los que ya tienen level >= LEAD
 * - LEAD: enrichments con level=LEAD
 * - CLIENT: enrichments con level=CLIENT
 */
async function getStatsByLevelForPartner(partnerId) {
  try {
    logger.info(`[getStatsByLevelForPartner] Calculando stats para partnerId=${partnerId}`);
    
    // Contar enriquecimientos del partner por nivel
    const enrichmentStats = await prisma.establishmentEnrichment.groupBy({
      by: ["level"],
      where: { enrichedBy: partnerId },
      _count: { id: true },
    });

    const enrichmentByLevel = enrichmentStats.reduce((acc, stat) => {
      acc[stat.level] = stat._count.id;
      return acc;
    }, {});
    
    logger.info(`[getStatsByLevelForPartner] enrichmentByLevel:`, JSON.stringify(enrichmentByLevel));

    // ARQUITECTURA SIMPLIFICADA: 
    // Ahora PROSPECT también se cuenta desde establishmentEnrichment
    // ya que el agente SDR guarda directamente ahí con level=PROSPECT
    // Esto es más consistente y evita problemas de sincronización entre tablas
    
    const result = {
      CONTACT: enrichmentByLevel.CONTACT || 0,
      PROSPECT: enrichmentByLevel.PROSPECT || 0,  // Ahora desde enrichment, no leadProspect
      LEAD: enrichmentByLevel.LEAD || 0,
      CLIENT: enrichmentByLevel.CLIENT || 0,
    };
    
    logger.info(`[getStatsByLevelForPartner] Resultado final:`, JSON.stringify(result));

    return result;
  } catch (error) {
    logger.error("Error obteniendo estadísticas del partner por nivel:", error);
    throw error;
  }
}

/**
 * Obtener datos del partner según el nivel solicitado
 * 
 * ARQUITECTURA SIMPLIFICADA - EstablishmentEnrichment es la fuente de verdad:
 * - CONTACT: enrichments con level=CONTACT
 * - PROSPECT: lead_prospects asignados EXCLUYENDO los que ya tienen level >= LEAD
 * - LEAD: enrichments con level=LEAD
 * - CLIENT: enrichments con level=CLIENT
 * 
 * Combina con datos de establecimientos de Mapa DB y meetings
 */

/**
 * Obtener PROSPECT directamente de establishmentEnrichment (para SDR)
 * El agente SDR guarda con level=PROSPECT directamente en esta tabla
 */
async function getEnrichmentProspectsDirect(partnerId) {
  try {
    // Obtener enrichments con level=PROSPECT
    const enrichments = await prisma.establishmentEnrichment.findMany({
      where: {
        enrichedBy: partnerId,
        level: "PROSPECT",
      },
      orderBy: { updatedAt: "desc" },
    });

    if (enrichments.length === 0) {
      return [];
    }

    // Obtener IDs de establecimientos
    const establishmentIds = enrichments.map((e) => e.establishmentId);

    // DEBUG: Log IDs encontrados
    logger.info(`[getEnrichmentProspectsDirect] Encontrados ${enrichments.length} enrichments con level=PROSPECT, IDs: ${establishmentIds.join(', ')}`);

    // Obtener datos de establecimientos de Mapa DB (IDs son strings)
    const establishments = await prismaGeo.establishment.findMany({
      where: { id: { in: establishmentIds } },
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
    });

    logger.info(`[getEnrichmentProspectsDirect] Encontrados ${establishments.length} establecimientos en Mapa DB`);

    // Obtener meetings del partner para estos establecimientos
    const meetings = await prisma.establishmentMeeting.findMany({
      where: {
        partnerId,
        establishmentId: { in: establishmentIds },
      },
    });

    // Crear mapas para lookup rápido (convertir ID a string para match con enrichment.establishmentId)
    const establishmentMap = establishments.reduce((acc, e) => {
      acc[String(e.id)] = e;
      return acc;
    }, {});

    const meetingMap = meetings.reduce((acc, m) => {
      acc[m.establishmentId] = {
        meetingScheduled: m.meetingScheduled,
        meetingDate: m.meetingDate,
        meetingLink: m.meetingLink,
        notes: m.notes,
      };
      return acc;
    }, {});

    // Combinar datos - formato compatible con frontend (establishment como propiedad anidada)
    return enrichments.map((enrichment) => {
      const establishment = establishmentMap[enrichment.establishmentId] || {};
      const meeting = meetingMap[enrichment.establishmentId] || {};

      return {
        // Campos del enrichment a nivel raíz
        ...enrichment,
        establishmentId: enrichment.establishmentId,
        // Establishment como objeto anidado (requerido por frontend)
        establishment: {
          id: enrichment.establishmentId,
          name: establishment.name || "Establecimiento",
          activityName: establishment.activityName || "",
          phone: establishment.phone || enrichment.decisionMakerPhone || "",
          email: establishment.email || enrichment.decisionMakerEmail || "",
          website: establishment.website || "",
          latitude: establishment.latitude,
          longitude: establishment.longitude,
          municipalityName: establishment.municipalityName || "",
          stateName: establishment.stateName || "",
        },
        meeting,
      };
    });
  } catch (error) {
    logger.error("Error en getEnrichmentProspectsDirect:", error);
    return [];
  }
}

async function getEnrichmentsByPartner(partnerId, level = null) {
  try {
    // SIMPLIFICADO: Todos los niveles se obtienen directamente de EstablishmentEnrichment
    // Ya no usamos lead_prospects para PROSPECT - todo en una sola tabla
    const where = { enrichedBy: partnerId };
    if (level) {
      where.level = level;
    }

    // Obtener enriquecimientos de Partners DB
    const enrichments = await prisma.establishmentEnrichment.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    if (enrichments.length === 0) {
      return [];
    }

    // Obtener IDs de establecimientos (UUIDs)
    const establishmentIds = enrichments.map((e) => e.establishmentId);

    // Obtener datos de establecimientos de Mapa DB (buscar por UUID)
    const establishments = await prismaGeo.establishment.findMany({
      where: { id: { in: establishmentIds } },
      select: {
        id: true,
        clee: true,
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
    });

    // Obtener meetings del partner para estos establecimientos
    const meetings = await prisma.establishmentMeeting.findMany({
      where: {
        partnerId,
        establishmentId: { in: establishmentIds },
      },
    });

    // Crear mapas para lookup rapido (usar UUID como key)
    const establishmentMap = establishments.reduce((acc, e) => {
      acc[e.id] = e;
      return acc;
    }, {});

    const meetingMap = meetings.reduce((acc, m) => {
      acc[m.establishmentId] = {
        meetingScheduled: m.meetingScheduled,
        meetingDate: m.meetingDate,
        meetingLink: m.meetingLink,
        notes: m.notes,
      };
      return acc;
    }, {});

    // Combinar datos - filtrar los que no tienen establishment válido
    return enrichments
      .map((e) => ({
        ...e,
        establishment: establishmentMap[e.establishmentId] || null,
        meeting: meetingMap[e.establishmentId] || null,
      }))
      .filter((e) => e.establishment !== null);
  } catch (error) {
    logger.error("Error obteniendo enriquecimientos del partner:", error);
    throw error;
  }
}

/**
 * Obtener prospectos asignados al partner desde lead_prospects
 * EXCLUYE los que ya tienen enrichment con nivel LEAD o CLIENT
 * Combina con datos de establecimiento de Mapa DB y enriquecimiento de Partners DB
 */
async function getProspectsByPartner(partnerId) {
  try {
    // Primero obtener IDs de establecimientos que ya tienen nivel LEAD o CLIENT
    const advancedEnrichments = await prisma.establishmentEnrichment.findMany({
      where: {
        enrichedBy: partnerId,
        level: { in: ["LEAD", "CLIENT"] }
      },
      select: { establishmentId: true },
    });
    const advancedIds = advancedEnrichments.map(e => e.establishmentId);

    // Obtener prospectos del partner (solo ASSIGNED) EXCLUYENDO los avanzados
    const prospects = await prisma.leadProspect.findMany({
      where: {
        partnerId,
        status: "ASSIGNED",
        establishmentId: advancedIds.length > 0 ? { notIn: advancedIds } : undefined
      },
      orderBy: { createdAt: "desc" },
    });

    if (prospects.length === 0) {
      return [];
    }

    // Obtener IDs de establecimientos
    const establishmentIds = prospects.map((p) => p.establishmentId);

    // Obtener datos de establecimientos de Mapa DB
    const establishments = await prismaGeo.establishment.findMany({
      where: { id: { in: establishmentIds } },
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
    });

    // Obtener enriquecimientos existentes para estos establecimientos
    const enrichments = await prisma.establishmentEnrichment.findMany({
      where: { establishmentId: { in: establishmentIds } },
    });

    // Obtener meetings del partner para estos establecimientos
    const meetings = await prisma.establishmentMeeting.findMany({
      where: {
        partnerId,
        establishmentId: { in: establishmentIds },
      },
    });

    // Crear mapas para lookup rápido
    const establishmentMap = establishments.reduce((acc, e) => {
      acc[e.id] = e;
      return acc;
    }, {});

    const enrichmentMap = enrichments.reduce((acc, e) => {
      acc[e.establishmentId] = e;
      return acc;
    }, {});

    const meetingMap = meetings.reduce((acc, m) => {
      acc[m.establishmentId] = {
        meetingScheduled: m.meetingScheduled,
        meetingDate: m.meetingDate,
        meetingLink: m.meetingLink,
        notes: m.notes,
      };
      return acc;
    }, {});

    // Combinar datos - devolver en formato compatible con enrichments
    return prospects
      .map((p) => {
        const establishment = establishmentMap[p.establishmentId] || null;
        const enrichment = enrichmentMap[p.establishmentId] || null;
        const meeting = meetingMap[p.establishmentId] || null;

        return {
          id: enrichment?.id || p.id,
          establishmentId: p.establishmentId,
          level: "PROSPECT",
          // Datos de enriquecimiento si existen
          decisionMakerName: enrichment?.decisionMakerName || null,
          decisionMakerPosition: enrichment?.decisionMakerPosition || null,
          decisionMakerPhone: enrichment?.decisionMakerPhone || null,
          decisionMakerWhatsApp: enrichment?.decisionMakerWhatsApp || null,
          decisionMakerEmail: enrichment?.decisionMakerEmail || null,
          intent: enrichment?.intent || null,
          fear: enrichment?.fear || null,
          pain: enrichment?.pain || null,
          desire: enrichment?.desire || null,
          // Metadatos del prospecto
          enrichedBy: partnerId,
          enrichedAt: p.assignedAt,
          notes: p.notes,
          status: p.status,
          createdAt: p.createdAt,
          updatedAt: enrichment?.updatedAt || p.updatedAt,
          // Establecimiento y meeting
          establishment,
          meeting,
        };
      })
      .filter((p) => p.establishment !== null);
  } catch (error) {
    logger.error("Error obteniendo prospectos del partner:", error);
    throw error;
  }
}

/**
 * Obtener leads del partner desde tabla leads
 * Combina con datos adicionales
 */
async function getLeadsByPartner(partnerId) {
  try {
    // Obtener leads del partner
    const leads = await prisma.lead.findMany({
      where: { partnerId },
      orderBy: { createdAt: "desc" },
    });

    if (leads.length === 0) {
      return [];
    }

    // Devolver leads en formato compatible
    return leads.map((lead) => ({
      id: lead.id,
      establishmentId: null, // Los leads no tienen establishmentId directo
      level: "LEAD",
      // Datos del lead
      decisionMakerName: lead.contactName,
      decisionMakerPosition: null,
      decisionMakerPhone: lead.phone,
      decisionMakerWhatsApp: null,
      decisionMakerEmail: lead.email,
      intent: null,
      fear: null,
      pain: null,
      desire: null,
      // Metadatos
      enrichedBy: partnerId,
      enrichedAt: lead.createdAt,
      notes: lead.notes,
      status: lead.status,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      // Establecimiento simulado desde datos del lead
      establishment: {
        id: lead.id,
        name: lead.businessName,
        activityName: lead.businessType,
        phone: lead.phone,
        email: lead.email,
        website: null,
        latitude: null,
        longitude: null,
        municipalityName: lead.location?.split(",")[0]?.trim() || null,
        stateName: lead.location?.split(",")[1]?.trim() || null,
      },
    }));
  } catch (error) {
    logger.error("Error obteniendo leads del partner:", error);
    throw error;
  }
}

/**
 * Eliminar un enriquecimiento
 * Lee/escribe en Partners DB
 */
async function deleteEnrichment(establishmentId, partnerId) {
  try {
    const enrichment = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId },
    });

    if (!enrichment) {
      throw new Error("Enriquecimiento no encontrado");
    }

    // Solo el partner que creó puede eliminar (o un admin)
    if (enrichment.enrichedBy !== partnerId) {
      throw new Error("No tienes permisos para eliminar este enriquecimiento");
    }

    // Eliminar el enriquecimiento y el registro asociado en LeadProspect
    await prisma.$transaction([
      prisma.establishmentEnrichment.delete({
        where: { establishmentId },
      }),
      prisma.leadProspect.deleteMany({
        where: { establishmentId },
      }),
    ]);

    logger.info(
      `Enriquecimiento y LeadProspect eliminados para establecimiento ${establishmentId}`
    );
    return true;
  } catch (error) {
    logger.error("Error eliminando enriquecimiento:", error);
    throw error;
  }
}

// ============================================
// FUNCIONES ADMIN
// ============================================

/**
 * Obtener todos los enriquecimientos (Admin)
 * Combina Partners DB (enriquecimientos) con Mapa DB (establecimientos)
 */
async function getAllEnrichments(filters = {}) {
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
    } = filters;

    // Construir condiciones where para Partners DB
    const where = {};

    if (partnerId) {
      where.enrichedBy = partnerId;
    }

    if (level) {
      where.level = level;
    }

    // Obtener total de Partners DB
    const total = await prisma.establishmentEnrichment.count({ where });

    // Obtener enriquecimientos paginados de Partners DB
    const enrichments = await prisma.establishmentEnrichment.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    });

    if (enrichments.length === 0) {
      return {
        data: [],
        total,
        page,
        totalPages: Math.ceil(total / limit),
        limit,
      };
    }

    // Obtener IDs de establecimientos
    const establishmentIds = enrichments.map((e) => e.establishmentId);

    // Construir filtro para Mapa DB
    const establishmentWhere = { id: { in: establishmentIds } };
    if (state) {
      establishmentWhere.stateName = { contains: state, mode: "insensitive" };
    }
    if (municipality) {
      establishmentWhere.municipalityName = {
        contains: municipality,
        mode: "insensitive",
      };
    }
    if (search) {
      establishmentWhere.name = { contains: search, mode: "insensitive" };
    }

    // Obtener datos de establecimientos de Mapa DB
    const establishments = await prismaGeo.establishment.findMany({
      where: establishmentWhere,
      select: {
        id: true,
        name: true,
        activityName: true,
        activityCode: true,
        phone: true,
        email: true,
        website: true,
        latitude: true,
        longitude: true,
        municipalityName: true,
        stateName: true,
        postalCode: true,
        employeeRange: true,
      },
    });

    // Crear mapa para lookup rápido
    const establishmentMap = establishments.reduce((acc, e) => {
      acc[e.id] = e;
      return acc;
    }, {});

    // Obtener información de partners
    const partnerIds = [
      ...new Set(enrichments.map((e) => e.enrichedBy).filter(Boolean)),
    ];

    const partners = await prisma.partner.findMany({
      where: { id: { in: partnerIds } },
      select: {
        id: true,
        code: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    const partnersMap = partners.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {});

    // Combinar y filtrar datos
    let enrichmentsWithData = enrichments.map((e) => ({
      ...e,
      establishment: establishmentMap[e.establishmentId] || null,
      partner: partnersMap[e.enrichedBy] || null,
    }));

    // Filtrar si hay filtros de ubicación/búsqueda
    if (state || municipality || search) {
      enrichmentsWithData = enrichmentsWithData.filter(
        (e) => e.establishment !== null
      );
    }

    return {
      data: enrichmentsWithData,
      total:
        state || municipality || search ? enrichmentsWithData.length : total,
      page,
      totalPages: Math.ceil(total / limit),
      limit,
    };
  } catch (error) {
    logger.error("Error obteniendo todos los enriquecimientos:", error);
    throw error;
  }
}

/**
 * Obtener estadísticas globales por partner (Admin)
 * Combina Mapa DB (totales) con Partners DB (enriquecimientos)
 */
async function getGlobalStatsByPartner() {
  try {
    // Contar establecimientos totales de Mapa DB
    const totalEstablishments = await prismaGeo.establishment.count();

    // Contar establecimientos con contacto de Mapa DB
    const totalContacts = await prismaGeo.establishment.count({
      where: {
        OR: [
          { phone: { not: null } },
          { email: { not: null } },
          { website: { not: null } },
        ],
      },
    });

    // Estadísticas de enriquecimientos por nivel de Partners DB
    const enrichmentStats = await prisma.establishmentEnrichment.groupBy({
      by: ["level"],
      _count: { id: true },
    });

    const enrichmentByLevel = enrichmentStats.reduce((acc, stat) => {
      acc[stat.level] = stat._count.id;
      return acc;
    }, {});

    // Estadísticas globales
    const global = {
      ESTABLISHMENT: totalEstablishments,
      CONTACT: totalContacts,
      PROSPECT: enrichmentByLevel.PROSPECT || 0,
      LEAD: enrichmentByLevel.LEAD || 0,
      CLIENT: enrichmentByLevel.CLIENT || 0,
    };

    const totalEnrichments =
      (enrichmentByLevel.PROSPECT || 0) +
      (enrichmentByLevel.LEAD || 0) +
      (enrichmentByLevel.CLIENT || 0);

    // Estadísticas por partner de Partners DB
    const partnerStats = await prisma.establishmentEnrichment.groupBy({
      by: ["enrichedBy", "level"],
      _count: { id: true },
    });

    // Agrupar por partner
    const byPartnerMap = {};
    partnerStats.forEach((stat) => {
      if (!stat.enrichedBy) return;
      if (!byPartnerMap[stat.enrichedBy]) {
        byPartnerMap[stat.enrichedBy] = {
          partnerId: stat.enrichedBy,
          counts: { CONTACT: 0, PROSPECT: 0, LEAD: 0, CLIENT: 0 },
          total: 0,
        };
      }
      byPartnerMap[stat.enrichedBy].counts[stat.level] = stat._count.id;
      byPartnerMap[stat.enrichedBy].total += stat._count.id;
    });

    // Obtener info de partners
    const partnerIds = Object.keys(byPartnerMap);
    const partners = await prisma.partner.findMany({
      where: { id: { in: partnerIds } },
      select: {
        id: true,
        code: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    const byPartner = partners.map((p) => ({
      partnerId: p.id,
      partnerCode: p.code,
      partnerName: p.user?.name || "Sin nombre",
      partnerEmail: p.user?.email || "",
      counts: byPartnerMap[p.id]?.counts || {
        CONTACT: 0,
        PROSPECT: 0,
        LEAD: 0,
        CLIENT: 0,
      },
      total: byPartnerMap[p.id]?.total || 0,
    }));

    byPartner.sort((a, b) => b.total - a.total);

    return {
      global,
      totalEnrichments,
      byPartner,
    };
  } catch (error) {
    logger.error("Error obteniendo estadísticas globales:", error);
    throw error;
  }
}

/**
 * Eliminar un enriquecimiento (Admin - sin validación de permisos)
 */
async function adminDeleteEnrichment(establishmentId) {
  try {
    const enrichment = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId },
    });

    if (!enrichment) {
      throw new Error("Enriquecimiento no encontrado");
    }

    // Eliminar el enriquecimiento y el registro asociado en LeadProspect
    await prisma.$transaction([
      prisma.establishmentEnrichment.delete({
        where: { establishmentId },
      }),
      prisma.leadProspect.deleteMany({
        where: { establishmentId },
      }),
    ]);

    logger.info(
      `Enriquecimiento y LeadProspect eliminados por admin para establecimiento ${establishmentId}`
    );
    return true;
  } catch (error) {
    logger.error("Error eliminando enriquecimiento (admin):", error);
    throw error;
  }
}

/**
 * Actualizar datos de meeting de un enriquecimiento
 */
async function updateMeetingDetails(establishmentId, meetingData, partnerId) {
  try {
    // Verificar que existe el enriquecimiento y pertenece al partner
    const enrichment = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId },
    });

    if (!enrichment) {
      throw new Error("Enriquecimiento no encontrado");
    }

    if (enrichment.enrichedBy !== partnerId) {
      throw new Error("No tienes permisos para modificar este enriquecimiento");
    }

    // Actualizar datos de meeting
    const updated = await prisma.establishmentEnrichment.update({
      where: { establishmentId },
      data: {
        meetingScheduled: meetingData.meetingScheduled ?? false,
        meetingDate: meetingData.meetingDate ? new Date(meetingData.meetingDate) : null,
        meetingLink: meetingData.meetingLink || null,
        lastUpdatedBy: partnerId,
      },
    });

    // Obtener datos del establecimiento de Mapa DB
    const establishment = await prismaGeo.establishment.findUnique({
      where: { id: establishmentId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        activityName: true,
        municipalityName: true,
        stateName: true,
      },
    });

    logger.info(
      `Meeting ${meetingData.meetingScheduled ? "agendado" : "cancelado"} para establecimiento ${establishmentId}`
    );

    return {
      ...updated,
      establishment,
    };
  } catch (error) {
    logger.error("Error actualizando meeting:", error);
    throw error;
  }
}

/**
 * Obtener meetings programados en un rango de fechas
 */
async function getScheduledMeetings(partnerId, startDate, endDate) {
  try {
    const meetings = await prisma.establishmentEnrichment.findMany({
      where: {
        enrichedBy: partnerId,
        meetingScheduled: true,
        meetingDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        establishmentId: true,
        meetingDate: true,
        meetingLink: true,
      },
    });

    // Obtener nombres de establecimientos de Mapa DB
    const establishmentIds = meetings.map(m => m.establishmentId);
    const establishments = await prismaGeo.establishment.findMany({
      where: { id: { in: establishmentIds } },
      select: {
        id: true,
        name: true,
      },
    });

    const establishmentMap = new Map(establishments.map(e => [e.id, e]));

    return meetings.map(meeting => ({
      id: meeting.id,
      establishmentId: meeting.establishmentId,
      establishmentName: establishmentMap.get(meeting.establishmentId)?.name || "Sin nombre",
      meetingDate: meeting.meetingDate,
      meetingLink: meeting.meetingLink,
    }));
  } catch (error) {
    logger.error("Error obteniendo meetings programados:", error);
    throw error;
  }
}

/**
 * Registrar un evento de enriquecimiento en campaign_enrichments (fire-and-forget)
 * @param {Object} options
 */
async function logEnrichmentEvent({
  establishmentId,
  source,
  campaignId = null,
  campaignContactId = null,
  conversationId = null,
  agentStage = null,
  levelReached = null,
  enrichmentSnapshot = null,
  enrichedBy = null,
  enrichedByType = null,
  notes = null,
}) {
  try {
    await prisma.campaignEnrichment.create({
      data: {
        establishmentId,
        source,
        campaignId,
        campaignContactId,
        conversationId,
        agentStage,
        levelReached,
        enrichmentSnapshot,
        enrichedBy,
        enrichedByType,
        notes,
      },
    });
  } catch (err) {
    logger.warn('[CampaignEnrichment] Error logging event (no crítico):', { error: err.message });
  }
}

module.exports = {
  calculateLevel,
  getEnrichmentByEstablishment,
  createOrUpdateEnrichment,
  logEnrichmentEvent,
  bulkImportEnrichments,
  getStatsByLevel,
  getStatsByLevelForPartner,
  getEnrichmentsByPartner,
  deleteEnrichment,
  updateMeetingDetails,
  getScheduledMeetings,
  // Admin functions
  getAllEnrichments,
  getGlobalStatsByPartner,
  adminDeleteEnrichment,
};
