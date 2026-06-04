const campaignsService = require("../services/campaignsService");
const campaignCouponValidationService = require("../services/campaignCouponValidationService");
const {
  STAGE_PREREQUISITES,
  PRIOR_STAGE_DISPLAY,
  classifyEstablishmentsByStage,
  buildPhoneVariantsForQuery,
  buildContactedPhonesSet,
  findPhonesInProcess,
  ALREADY_CONTACTED_STATUSES,
} = require("../services/campaignsService");
const { parseCSV, MAX_ROWS } = require("../services/csvContactsParserService");
const logger = require("../config/logger");
const axios = require('axios');
const geoService = require("../services/geoService");
const prisma = require("../config/database");

// Construye un texto user-facing claro y específico por caso
// para el endpoint de elegibilidad. Devuelve null si todos son elegibles.
const buildEligibilityMessage = ({
  campaignType,
  totalInZone,
  total,
  eligibleCount,
  excludedNoPrereq,
  excludedAdvanced,
}) => {
  const priorStageName = PRIOR_STAGE_DISPLAY[campaignType];
  const typeName = campaignType
    ? campaignType.charAt(0) + campaignType.slice(1).toLowerCase()
    : 'campaña';

  if (totalInZone === 0) {
    return {
      tone: 'error',
      headline: 'Sin restaurantes en la zona',
      detail: 'No se encontraron restaurantes dentro del radio seleccionado. Amplía el radio o mueve el centro del mapa.',
    };
  }

  if (total === 0) {
    return {
      tone: 'error',
      headline: 'Sin coincidencias con los filtros',
      detail: `Hay ${totalInZone} restaurantes en la zona, pero ninguno coincide con los tipos de actividad o rangos de empleados elegidos.`,
    };
  }

  if (eligibleCount === 0) {
    if (campaignType === 'DISCOVERY') {
      return {
        tone: 'error',
        headline: 'Todos en etapas posteriores',
        detail: `Los ${total} restaurantes de esta zona ya pasaron por Discovery. Para no sobrescribir su progreso del funnel, no se pueden incluir en una campaña de Discovery.`,
      };
    }
    if (excludedAdvanced > 0 && excludedNoPrereq === 0) {
      return {
        tone: 'error',
        headline: `Todos están más avanzados que ${typeName}`,
        detail: `Los ${total} restaurantes ya están en una etapa igual o posterior. No se incluyen para no sobrescribir su estado del funnel.`,
      };
    }
    if (excludedNoPrereq > 0 && excludedAdvanced === 0) {
      return {
        tone: 'error',
        headline: `Falta completar ${priorStageName}`,
        detail: `Ninguno de los ${total} restaurantes ha completado ${priorStageName}. Ejecuta primero una campaña de ${priorStageName} en esta zona.`,
      };
    }
    return {
      tone: 'error',
      headline: `Sin restaurantes elegibles para ${typeName}`,
      detail: `Ninguno cumple la etapa exacta requerida (${priorStageName} completado). ${excludedNoPrereq} aún no llegan a esa etapa y ${excludedAdvanced} ya están más avanzados.`,
    };
  }

  // Hay elegibles pero también excluidos: explicar exactamente qué pasa con los excluidos.
  const excludedTotal = excludedNoPrereq + excludedAdvanced;
  if (excludedTotal === 0) return null;

  if (excludedNoPrereq > 0 && excludedAdvanced > 0) {
    return {
      tone: 'warning',
      headline: `${eligibleCount} de ${total} elegibles`,
      detail: `${excludedNoPrereq} restaurante(s) aún no completan ${priorStageName} y ${excludedAdvanced} ya están en una etapa posterior (se omiten para no sobrescribir su progreso).`,
    };
  }
  if (excludedNoPrereq > 0) {
    return {
      tone: 'warning',
      headline: `${eligibleCount} de ${total} elegibles`,
      detail: `${excludedNoPrereq} restaurante(s) aún no completan ${priorStageName} y se omiten del batch.`,
    };
  }
  return {
    tone: 'warning',
    headline: `${eligibleCount} de ${total} elegibles`,
    detail: `${excludedAdvanced} restaurante(s) ya están en una etapa igual o posterior a ${typeName} y se omiten para no sobrescribir su progreso del funnel.`,
  };
};

const getReengagementCandidates = async (req, res, next) => {
  try {
    const {
      sourceCampaignId,
      outcomes,
      lastCalledFrom,
      lastCalledTo,
      campaignTypes,
      agentConfigId,
      excludeActiveCampaigns,
      excludeClients,
      limit,
    } = req.query;

    const result = await campaignsService.getReengagementCandidates({
      sourceCampaignId,
      outcomes: outcomes ? outcomes.split(',').map(o => o.trim()) : undefined,
      lastCalledFrom,
      lastCalledTo,
      campaignTypes: campaignTypes ? campaignTypes.split(',').map(t => t.trim()) : undefined,
      agentConfigId,
      excludeActiveCampaigns: excludeActiveCampaigns !== 'false',
      excludeClients: excludeClients !== 'false',
      limit: limit ? parseInt(limit) : undefined,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {
  try {
    const {
      name, description, type, centerLat, centerLng, radiusMeters,
      activityCodes, employeeRanges, filters, agentConfigId, agentConfigName,
      offer, couponPrefix, couponTemplateIds,
      // Reenganche
      establishmentIds, sourceCampaignId,
      // CSV
      csvContacts, contactSource, csvMetadata,
    } = req.body;

    const campaign = await campaignsService.createCampaign({
      name,
      description,
      type,
      centerLat,
      centerLng,
      radiusMeters,
      activityCodes,
      employeeRanges,
      filters,
      agentConfigId,
      agentConfigName,
      offer,
      couponPrefix,
      couponTemplateIds,
      createdBy: req.user?.id,
      establishmentIds,
      sourceCampaignId,
      csvContacts,
      contactSource,
      csvMetadata,
    });

    res.status(201).json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

const list = async (req, res, next) => {
  try {
    const { status, page, limit, includeQuickActions } = req.query;

    const createdBy = req.user?.role === "ADMIN" ? undefined : req.user?.id;

    const result = await campaignsService.listCampaigns({
      status,
      createdBy,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      includeQuickActions: includeQuickActions === 'true',
    });

    res.json({
      success: true,
      data: result.campaigns,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const campaign = await campaignsService.getCampaignById(id);

    // if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     error: "No tienes permisos para ver esta campaña",
    //   });
    // }

    res.json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      type,
      status,
      centerLat,
      centerLng,
      radiusMeters,
      activityCodes,
      employeeRanges,
      filters,
      agentConfigId,
      agentConfigName,
      offer,
      couponPrefix,
      couponTemplateIds
    } = req.body;

    const existingCampaign = await campaignsService.getCampaignById(id);

    // if (req.user?.role !== "ADMIN" && existingCampaign.createdBy !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     error: "No tienes permisos para editar esta campaña",
    //   });
    // }

    // Prevent editing active campaigns
    if (existingCampaign.status === "ACTIVE") {
      return res.status(400).json({
        success: false,
        error: "No se puede editar una campaña activa",
      });
    }

    const campaign = await campaignsService.updateCampaign(id, {
      name,
      description,
      type,
      status,
      centerLat,
      centerLng,
      radiusMeters,
      activityCodes,
      employeeRanges,
      filters,
      agentConfigId,
      agentConfigName,
      offer,
      couponPrefix,
      couponTemplateIds,
    });

    res.json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

const deleteCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existingCampaign = await campaignsService.getCampaignById(id);

    // if (req.user?.role !== "ADMIN" && existingCampaign.createdBy !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     error: "No tienes permisos para eliminar esta campaña",
    //   });
    // }

    await campaignsService.deleteCampaign(id);

    res.json({
      success: true,
      message: "Campaña eliminada exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

const assignContacts = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { establishmentIds } = req.body;

    const campaign = await campaignsService.getCampaignById(id);

    if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para asignar contactos a esta campaña",
      });
    }

    const contacts = await campaignsService.assignContactsToCampaign(id, establishmentIds);

    res.json({
      success: true,
      data: contacts,
      message: `${contacts.length} contactos asignados exitosamente`,
    });
  } catch (error) {
    next(error);
  }
};

const assignContactsWithGeo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { filters } = req.body;

    const campaign = await campaignsService.getCampaignById(id);

    if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para asignar contactos a esta campaña",
      });
    }

    const contacts = await campaignsService.assignContactsWithGeoFilter(id, filters);

    res.json({
      success: true,
      data: contacts,
      message: `${contacts.length} contactos asignados exitosamente usando filtro geográfico`,
    });
  } catch (error) {
    next(error);
  }
};

const getContacts = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, page, limit } = req.query;

    const campaign = await campaignsService.getCampaignById(id);

    // if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     error: "No tienes permisos para ver los contactos de esta campaña",
    //   });
    // }

    const result = await campaignsService.getCampaignContacts(id, {
      status,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });

    res.json({
      success: true,
      data: result.contacts,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const getEligibleCount = async (req, res) => {
  try {
    const { agentConfigId, centerLat, centerLng, radiusKm, activityCodes, employeeRanges } = req.query;

    //validar parametros requeridos
    if (!agentConfigId || !centerLat || !centerLng || !radiusKm || !activityCodes) {
      return res.status(400).json({
        success: false,
        error: "Missing Required Parameters"
      });
    }

    // Obtener tipo de campaña
    const campaignType = campaignsService.getCampaignTypeFromAgent(agentConfigId);
    // Validar que el agentConfigId sea válido
    if (!campaignType) {
      return res.status(400).json({
        success: false,
        error: "Invalid agentConfigId - not found in campaign type map"
      });
    }

    const prerequisite = STAGE_PREREQUISITES[campaignType];
    const radiusMeters = parseFloat(radiusKm) * 1000;
    const lat = parseFloat(centerLat);
    const lng = parseFloat(centerLng);

    // Construir filtros de audiencia (activityCodes + employeeRanges)
    const filters = {};
    if (activityCodes) {
      filters.activityCode = Array.isArray(activityCodes) ? activityCodes.join(",") : activityCodes;
    }
    if (employeeRanges) {
      filters.employeeRange = Array.isArray(employeeRanges) ? employeeRanges.join(",") : employeeRanges;
    }

    // Contar establecimientos por tipo de restaurante (sin filtro de empleados) y filtrados completos en paralelo
    const activityOnlyFilters = {};
    if (activityCodes) {
      activityOnlyFilters.activityCode = Array.isArray(activityCodes) ? activityCodes.join(",") : activityCodes;
    }

    const [allInZone, establishments] = await Promise.all([
      geoService.findEstablishmentsInRadius(lat, lng, radiusMeters, activityOnlyFilters),
      geoService.findEstablishmentsInRadius(lat, lng, radiusMeters, filters),
    ]);

    const totalInZone = allInZone.length;
    const total = establishments.length;
    const establishmentIds = establishments.map(e => e.id);

    // Clasificación unificada por rango: misma lógica que la asignación real al crear campaña
    const { eligibleIds, excludedNoPrereq, excludedAdvanced } =
      await classifyEstablishmentsByStage(establishmentIds, campaignType);
    const eligibleCount = eligibleIds.length;

    const message = buildEligibilityMessage({
      campaignType,
      totalInZone,
      total,
      eligibleCount,
      excludedNoPrereq,
      excludedAdvanced,
    });

    logger.info("[getEligibleCount] Debug info", {
      campaignType,
      prerequisite,
      totalInZone,
      totalWithFilters: total,
      eligibleCount,
      excludedNoPrereq,
      excludedAdvanced,
    });

    res.json({
      totalInZone,
      total,
      eligible: eligibleCount,
      excludedNoPrereq,
      excludedAdvanced,
      campaignType,
      prerequisite,
      priorStageName: PRIOR_STAGE_DISPLAY[campaignType] || null,
      // Compat retro: ineligibleReason (string corto). El nuevo `message` tiene headline+detail+tone.
      ineligibleReason: message && message.tone === 'error' ? message.detail : null,
      message,
    });

  } catch (error) {
    logger.error("Error getting eligible count", { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

const updateContactStatus = async (req, res, next) => {
  try {
    const { contactId } = req.params;
    const { status, messageId, errorReason } = req.body;

    const contact = await campaignsService.updateContactStatus(contactId, status, {
      messageId,
      errorReason,
    });

    res.json({
      success: true,
      data: contact,
    });
  } catch (error) {
    next(error);
  }
};

const getStats = async (req, res, next) => {
  try {
    const { id } = req.params;

    const campaign = await campaignsService.getCampaignById(id);

    // if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     error: "No tienes permisos para ver las estadísticas de esta campaña",
    //   });
    // }

    const stats = await campaignsService.getCampaignStats(id);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};


const apiKey = process.env.ELEVENLABS_API_KEY


const getAgents = async (req, res, next) => {
  try {
    const response = await axios.get('https://api.elevenlabs.io/v1/convai/agents', {
      headers: {
        'xi-api-key': apiKey
      },
    });

    const agentsArray = Array.isArray(response.data) ? response.data : response.data.agents || [];

    // Obtener IDs de agentes válidos para campañas
    const validCampaignAgentIds = campaignsService.getValidCampaignAgentIds();

    // Filtrar solo agentes de campaña y mapear
    const agents = agentsArray
      .filter(agent => validCampaignAgentIds.includes(agent.agent_id))
      .map(agent => ({
        id: agent.agent_id,
        name: agent.name,
        // Agregar el tipo de campaña para referencia
        campaignType: campaignsService.getCampaignTypeFromAgent(agent.agent_id)
      }));



    res.json({
      success: true,
      data: agents
    });
  } catch (error) {
    logger.error('Error fetching agents from ElevenLabs:', error);
    next(error);
  }
};

const startCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      agentId,
      targetConcurrencyLimit,
      maxRecipientsPerRequest,
      scheduledTimeUnix,
      agentPhoneNumberId,
    } = req.body || {};

    console.log('[startCampaign] Controller received:', {
      campaignId: id,
      scheduledTimeUnix,
      scheduledTimeUnixType: typeof scheduledTimeUnix,
      agentId,
      fullBody: req.body
    });

    const campaign = await campaignsService.getCampaignById(id);

    // if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     error: "No tienes permisos para iniciar esta campaña",
    //   });
    // }

    const result = await campaignsService.startCampaign(id, {
      agentId,
      targetConcurrencyLimit,
      maxRecipientsPerRequest,
      scheduledTimeUnix,
      agentPhoneNumberId,
    });

    console.log('[startCampaign] Result status:', result.status, 'Scheduled:', result.scheduledAt);

    res.json({
      success: true,
      data: result,
      message: "Campaña iniciada exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

const pauseCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;

    const campaign = await campaignsService.getCampaignById(id);

    // if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     error: "No tienes permisos para pausar esta campaña",
    //   });
    // }

    const result = await campaignsService.pauseCampaign(id);

    res.json({
      success: true,
      data: result,
      message: "Campaña pausada exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

const resumeCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;

    const campaign = await campaignsService.getCampaignById(id);

    // if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     error: "No tienes permisos para reanudar esta campaña",
    //   });
    // }

    const result = await campaignsService.resumeCampaign(id);

    let message = "Campaña reanudada exitosamente";
    if (result.reconciliedContacts > 0) {
      message += ` (${result.reconciliedContacts} contactos reconciliados)`;
    }

    res.json({
      success: true,
      data: result,
      message,
    });
  } catch (error) {
    next(error);
  }
};

const loadCouponTemplates = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { couponTemplateIds } = req.body;

    if (!Array.isArray(couponTemplateIds)) {
      return res.status(400).json({
        success: false,
        error: "couponTemplateIds must be an array"
      });
    }

    const { templates, validation } = await campaignCouponValidationService.loadAndValidateCouponTemplates(couponTemplateIds);

    logger.info("Coupon templates loaded for campaign", {
      campaignId: id,
      templateCount: templates.length,
      isValid: validation.isValid
    });

    res.json({
      success: true,
      data: {
        templates,
        validation
      }
    });
  } catch (error) {
    next(error);
  }
};

const getCampaignSendPreview = async (req, res, next) => {
  try {
    const { id } = req.params;

    const preview = await campaignCouponValidationService.getCampaignSendPreview(id);

    res.json({
      success: true,
      data: preview
    });
  } catch (error) {
    next(error);
  }
};

const validateBeforeStart = async (req, res, next) => {
  try {
    const { id } = req.params;

    const validation = await campaignCouponValidationService.validateCampaignBeforeStart(id);

    res.json({
      success: validation.isValid,
      data: validation
    });
  } catch (error) {
    next(error);
  }
};

const getCouponBreakdown = async (req, res, next) => {
  try {
    const { id } = req.params;

    const campaign = await campaignsService.getCampaignById(id);

    const breakdown = await campaignsService.getCouponBreakdown(id);

    res.json({
      success: true,
      data: breakdown
    });
  } catch (error) {
    next(error);
  }
};

const pause = async (req, res, next) => {
  try {
    const { id } = req.params;
    const campaign = await campaignsService.pauseCampaign(id);
    res.json({
      success: true,
      data: campaign,
      message: "Campaña pausada exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

const cancel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const campaign = await campaignsService.cancelCampaign(id);
    res.json({
      success: true,
      data: campaign,
      message: "Campaña cancelada exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

const reschedule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scheduledTimeUnix } = req.body;

    if (!scheduledTimeUnix) {
      return res.status(400).json({
        success: false,
        error: "scheduledTimeUnix es requerido",
      });
    }

    const campaign = await campaignsService.rescheduleCampaign(id, scheduledTimeUnix);
    res.json({
      success: true,
      data: campaign,
      message: "Campaña reprogramada exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

const resume = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await campaignsService.startCampaign(id, req.body || {});
    res.json({
      success: true,
      data: result,
      message: "Campaña reanudada exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

const retry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { includeFailed, includeStaleCalling } = req.body || {};
    const result = await campaignsService.retryCampaignContacts(id, {
      includeFailed: includeFailed !== false,
      includeStaleCalling: includeStaleCalling !== false,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};
const getContinuationPreview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const preview = await campaignsService.previewContinuation(id);
    res.json({ success: true, data: preview });
  } catch (error) {
    next(error);
  }
};

const postContinueCampaign = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, scheduledAt, couponPrefix, couponTemplateIds, offer } = req.body;
    const campaign = await campaignsService.continueCampaign(id, {
      name,
      scheduledAt,
      couponPrefix,
      couponTemplateIds,
      offer,
      createdBy: req.user?.id,
    });
    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /campaigns/csv/preview
 * Parsea y valida un CSV sin crear campaña. Devuelve conteo de filas válidas/rechazadas
 * y un preview de los primeros 50 contactos para que el usuario confirme antes de crear.
 */
const previewCsv = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "Se requiere un archivo CSV (campo 'file')" });
    }

    const { originalname, buffer } = req.file;

    const result = parseCSV(buffer, originalname);

    // Verificar cuántos teléfonos válidos ya tienen historial en otras campañas.
    // Se generan variantes de formato para detectar coincidencias entre geo (sin +52) y CSV (E.164).
    let duplicateCount = 0;
    const validPhones = result.validRows.map(r => r.phone).filter(Boolean);

    if (validPhones.length > 0) {
      const phoneVariants = buildPhoneVariantsForQuery(validPhones);
      const existing = await prisma.campaignContact.findMany({
        where: {
          establishmentPhone: { in: phoneVariants },
          status: { in: ALREADY_CONTACTED_STATUSES },
        },
        select: { establishmentPhone: true },
        distinct: ['establishmentPhone'],
      });
      // Expandir a variantes y cruzar contra los phones del CSV para contar correctamente
      const contactedSet = buildContactedPhonesSet(existing);
      duplicateCount = validPhones.filter(p => contactedSet.has(p)).length;
    }

    return res.status(200).json({
      success: true,
      data: {
        validRowsPreview: result.validRows.slice(0, 50),
        validRows: result.validRows,
        rejectedRows: result.rejectedRows,
        totalRows: result.totalRows,
        validCount: result.validCount,
        rejectedCount: result.rejectedCount,
        // Cuántos serán excluidos al crear la campaña por teléfono ya contactado
        duplicateCount,
        limits: { maxRows: MAX_ROWS },
        originalName: originalname,
      },
    });
  } catch (error) {
    logger.warn("[campaignsController:previewCsv] CSV parse error", { error: error.message });
    return res.status(400).json({ success: false, error: error.message });
  }
};

// Rate-limit store en memoria: { userId -> [timestamps] }
const quickActionRateLimitStore = new Map();
const QUICK_ACTION_LIMIT = 10;
const QUICK_ACTION_WINDOW_MS = 60 * 60 * 1000; // 1 hora

function checkQuickActionRateLimit(userId) {
  const now = Date.now();
  const windowStart = now - QUICK_ACTION_WINDOW_MS;
  const timestamps = (quickActionRateLimitStore.get(userId) || []).filter(ts => ts > windowStart);
  if (timestamps.length >= QUICK_ACTION_LIMIT) {
    return false;
  }
  timestamps.push(now);
  quickActionRateLimitStore.set(userId, timestamps);
  return true;
}

// Derived from service's CAMPAIGN_TYPE_TO_AGENT map (avoids hardcoding)
const { CAMPAIGN_TYPE_TO_AGENT: CAMPAIGN_TYPE_TO_AGENT_ID } = require("../services/campaignsService");

const quickAction = async (req, res, next) => {
  try {
    const { establishmentId, campaignType } = req.body;

    if (!establishmentId || !campaignType) {
      return res.status(400).json({ success: false, error: 'establishmentId y campaignType son requeridos' });
    }

    const validTypes = ['DISCOVERY', 'QUALIFICATION', 'ACTIVATION', 'CONVERSION'];
    if (!validTypes.includes(campaignType)) {
      return res.status(400).json({ success: false, error: `campaignType debe ser uno de: ${validTypes.join(', ')}` });
    }

    const agentConfigId = CAMPAIGN_TYPE_TO_AGENT_ID[campaignType];
    if (!agentConfigId) {
      return res.status(400).json({ success: false, error: 'No hay agente configurado para este tipo de campaña' });
    }

    // Rate-limit por usuario (usando X-Sales-User-Id o user.id)
    const userId = req.headers['x-sales-user-id'] || req.user?.id || 'anonymous';
    if (!checkQuickActionRateLimit(userId)) {
      return res.status(429).json({
        success: false,
        error: `Límite alcanzado: máximo ${QUICK_ACTION_LIMIT} acciones automáticas por hora por usuario`,
      });
    }

    // Verificar elegibilidad del establecimiento para este tipo de campaña
    const { eligibleIds } = await classifyEstablishmentsByStage([establishmentId], campaignType);
    if (eligibleIds.length === 0) {
      const prerequisite = STAGE_PREREQUISITES[campaignType];
      const msg = prerequisite
        ? `Este contacto no cumple el prerequisito para ${campaignType} (requiere ${prerequisite}), o ya completó esta etapa`
        : `Este contacto ya completó la etapa ${campaignType}`;
      return res.status(409).json({ success: false, error: msg });
    }

    // Obtener nombre y telefono del establecimiento (telefono usado para dedup cross-campana)
    let establishmentName = establishmentId;
    let establishmentPhone = null;
    try {
      const prismaGeo = require('../config/database-geo');
      const est = await prismaGeo.establishment.findUnique({
        where: { id: establishmentId },
        select: { name: true, phone: true },
      });
      if (est?.name) establishmentName = est.name;
      if (est?.phone) establishmentPhone = est.phone;
    } catch (_) { }

    // Fallback: tomar el telefono del enrichment si geo no lo tiene (ej. contactos CSV/manuales)
    if (!establishmentPhone) {
      try {
        const enr = await prisma.establishmentEnrichment.findUnique({
          where: { establishmentId },
          select: { decisionMakerPhone: true, decisionMakerWhatsApp: true },
        });
        establishmentPhone = enr?.decisionMakerPhone || enr?.decisionMakerWhatsApp || null;
      } catch (_) { }
    }

    // Dedup por telefono: misma logica que campanas. Evita doble marcado del mismo numero
    // ya en una llamada en curso o contactado desde otra identidad (otro establishmentId).
    if (establishmentPhone) {
      const blocked = await findPhonesInProcess([{ establishmentId, phone: establishmentPhone }]);
      const reason = blocked.get(establishmentId);
      if (reason) {
        const msg = reason === 'in_flight'
          ? 'Este numero ya tiene una llamada en curso'
          : 'Este numero ya esta en otra campana o proceso activo';
        return res.status(409).json({ success: false, error: msg, reason });
      }
    }

    // Para ACTIVATION y CONVERSION auto-resolver el template de cupón de mayor prioridad activo.
    // Esto replica lo que haría el usuario al crear una campaña normal con cupón seleccionado.
    // DISCOVERY y QUALIFICATION no usan cupones (validado en createCampaign).
    const COUPON_TYPES = ['ACTIVATION', 'CONVERSION'];
    let resolvedCouponTemplateIds = [];
    if (COUPON_TYPES.includes(campaignType)) {
      try {
        const defaultTemplate = await prisma.couponTemplate.findFirst({
          where: { active: true },
          orderBy: { priority: 'desc' },
          select: { id: true },
        });
        if (defaultTemplate) resolvedCouponTemplateIds = [defaultTemplate.id];
      } catch (_) { }
    }

    // Crear micro-campaña con contactSource QUICK_ACTION
    const campaign = await campaignsService.createCampaign({
      name: `Quick ${campaignType} - ${establishmentName}`,
      description: `Acción rápida automática para ${establishmentName}`,
      type: campaignType,
      agentConfigId,
      contactSource: 'QUICK_ACTION',
      establishmentIds: [establishmentId],
      createdBy: userId,
      ...(resolvedCouponTemplateIds.length > 0 && { couponTemplateIds: resolvedCouponTemplateIds }),
    });

    // Iniciar campaña inmediatamente
    const result = await campaignsService.startCampaign(campaign.id);

    logger.info('[quickAction] Quick campaign dispatched', {
      campaignId: campaign.id,
      establishmentId,
      campaignType,
      userId,
    });

    res.status(201).json({
      success: true,
      data: { campaignId: campaign.id, status: result.status || 'dispatched' },
      message: `Llamada de ${campaignType} iniciada exitosamente`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/campaigns/phone-check?phone=XXX&establishmentId=YYY
 * Verifica si un telefono ya esta en proceso en alguna campana.
 * Usado por el mapa antes de agregar un restaurante a contactos, para advertir al usuario.
 */
const phoneCheck = async (req, res, next) => {
  try {
    const { phone, establishmentId } = req.query;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'phone es requerido' });
    }
    const blocked = await findPhonesInProcess([{
      establishmentId: establishmentId || '__map_check__',
      phone,
    }]);
    const reason = blocked.get(establishmentId || '__map_check__') || null;
    return res.json({
      success: true,
      data: { inUse: !!reason, reason },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  create,
  list,
  getById,
  update,
  delete: deleteCampaign,
  assignContacts,
  assignContactsWithGeo,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  getContacts,
  getEligibleCount,
  updateContactStatus,
  getStats,
  getAgents,
  loadCouponTemplates,
  getCampaignSendPreview,
  validateBeforeStart,
  getCouponBreakdown,
  getReengagementCandidates,
  pause,
  cancel,
  reschedule,
  resume,
  retry,
  getContinuationPreview,
  postContinueCampaign,
  previewCsv,
  quickAction,
  phoneCheck,
};
