const campaignsService = require("../services/campaignsService");
const campaignCouponValidationService = require("../services/campaignCouponValidationService");
const logger = require("../config/logger");
const axios = require('axios');

const create = async (req, res, next) => {
  try {
    const { name, description, type, centerLat, centerLng, radiusMeters, activityCodes, employeeRanges, filters, agentConfigId, agentConfigName, offer, couponPrefix, couponTemplateIds } = req.body;

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
    const { status, page, limit } = req.query;

    const createdBy = req.user?.role === "ADMIN" ? undefined : req.user?.id;

    const result = await campaignsService.listCampaigns({
      status,
      createdBy,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
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
  updateContactStatus,
  getStats,
  getAgents,
  loadCouponTemplates,
  getCampaignSendPreview,
  validateBeforeStart,
  getCouponBreakdown,
  pause,
  cancel,
  resume,
  retry,
};
