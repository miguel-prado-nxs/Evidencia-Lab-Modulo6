const campaignsService = require("../services/campaignsService");
const logger = require("../config/logger");
const axios = require('axios');

const create = async (req, res, next) => {
  try {
    const { name, description, type, centerLat, centerLng, radiusMeters, activityCodes, employeeRanges, filters, agentConfigId, agentConfigName, offer, couponPrefix } = req.body;

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
      couponPrefix
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
    const agents = agentsArray.map(agent => ({
      id: agent.agent_id,
      name: agent.name
    }));

    res.json({
      success: true,
      data: agents
    });
  } catch (error) {
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

    const campaign = await campaignsService.getCampaignById(id);

    // if (req.user?.role !== "ADMIN" && campaign.createdBy !== req.user?.id) {
    //   return res.status(403).json({
    //     success: false,
    //     error: "No tienes permisos para iniciar esta campaña",
    //   });
    // }

    const result = await campaignsService.startCampaign(id, {
      agentId,
    });

    res.json({
      success: true,
      data: result,
      message: "Campaña iniciada exitosamente",
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
  getContacts,
  updateContactStatus,
  getStats,
  getAgents,
};
