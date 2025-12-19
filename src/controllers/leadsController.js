const leadService = require("../services/leadService");
const logger = require("../config/logger");

// Listar leads
const list = async (req, res, next) => {
  try {
    const {
      partnerId,
      status,
      utmCampaign,
      utmSource,
      search,
      dateFrom,
      dateTo,
      page,
      limit,
      sortBy,
      sortOrder,
    } = req.query;

    // Si no es admin, filtrar solo por su partnerId
    const filterPartnerId = req.user.role === "ADMIN"
      ? partnerId
      : req.user.partner?.id;

    if (!filterPartnerId && req.user.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const result = await leadService.listLeads({
      partnerId: filterPartnerId,
      status,
      utmCampaign,
      utmSource,
      search,
      dateFrom,
      dateTo,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      sortBy: sortBy || "createdAt",
      sortOrder: sortOrder || "desc",
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

// Obtener lead por ID
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const lead = await leadService.getLeadById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead no encontrado",
      });
    }

    // Verificar permisos
    if (req.user.role !== "ADMIN" && req.user.partner?.id !== lead.partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para ver este lead",
      });
    }

    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    next(error);
  }
};

// Crear lead (manual por partner)
const create = async (req, res, next) => {
  try {
    const leadData = req.body;

    // Si no es admin, usar el partnerId del usuario
    const partnerId = req.user.role === "ADMIN"
      ? leadData.partnerId
      : req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const lead = await leadService.createLead({
      ...leadData,
      partnerId,
    });

    logger.info(`Lead creado: ${lead.id} por partner ${partnerId}`);

    res.status(201).json({
      success: true,
      data: lead,
    });
  } catch (error) {
    next(error);
  }
};

// Actualizar lead
const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const existingLead = await leadService.getLeadById(id);
    if (!existingLead) {
      return res.status(404).json({
        success: false,
        error: "Lead no encontrado",
      });
    }

    // Verificar permisos
    if (req.user.role !== "ADMIN" && req.user.partner?.id !== existingLead.partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para actualizar este lead",
      });
    }

    const lead = await leadService.updateLead(id, updateData);

    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    next(error);
  }
};

// Cambiar status del lead
const updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const existingLead = await leadService.getLeadById(id);
    if (!existingLead) {
      return res.status(404).json({
        success: false,
        error: "Lead no encontrado",
      });
    }

    // Verificar permisos
    if (req.user.role !== "ADMIN" && req.user.partner?.id !== existingLead.partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para actualizar este lead",
      });
    }

    const lead = await leadService.updateLeadStatus(id, status, notes);

    logger.info(`Lead ${id} status cambiado a ${status}`);

    res.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    next(error);
  }
};

// Tracking de lead desde landing (público)
const track = async (req, res, next) => {
  try {
    const { partnerCode, ...leadData } = req.body;

    if (!partnerCode) {
      return res.status(400).json({
        success: false,
        error: "Código de partner requerido",
      });
    }

    const lead = await leadService.trackLead(partnerCode, leadData);

    logger.info(`Lead tracked: ${lead.email} via partner ${partnerCode}`);

    res.status(201).json({
      success: true,
      data: {
        id: lead.id,
        message: "Lead registrado exitosamente",
      },
    });
  } catch (error) {
    if (error.message === "Partner no encontrado o inactivo") {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
};

// Enriquecer automáticamente un establecimiento
const autoEnrich = async (req, res, next) => {
  try {
    const {
      businessName,
      businessContact,
      employeeRange,
      establishmentId,
      address
    } = req.body;

    // Validar datos requeridos
    if (!businessName || !businessContact) {
      return res.status(400).json({
        success: false,
        error: "Se requieren: businessName y businessContact",
      });
    }

    // Registrar los datos recibidos para debugging
    console.log("=== AUTO-ENRICH DATOS RECIBIDOS (PARTNERS API) ===");
    console.log("Nombre del negocio:", businessName);
    console.log("Contacto del negocio:", businessContact);
    console.log("Rango de empleados:", employeeRange || "No especificado");
    console.log("Establishment ID:", establishmentId || "No especificado");
    console.log("Dirección:", address || "No especificada");
    console.log("Usuario:", req.user?.id);
    console.log("==================================================");

    // Verificar si AGENTS_SDK_URL está configurado
    const agentsSdkUrl = process.env.AGENTS_SDK_URL;
    if (!agentsSdkUrl) {
      logger.warn("AGENTS_SDK_URL no configurado - solo logging datos");
      return res.json({
        success: true,
        message: "Datos recibidos (AGENTS_SDK_URL no configurado)",
        receivedData: {
          businessName,
          businessContact,
          employeeRange: employeeRange || "No especificado",
          establishmentId: establishmentId || "No especificado",
        },
      });
    }

    // Llamar al agente SDR en agentes-crm-sdk
    const axios = require("axios");

    const sdrPayload = {
      establishment_id: establishmentId || `auto-${Date.now()}`,
      establishment_name: businessName,
      phone: businessContact,
      employee_range: employeeRange || "0 a 5 personas",
      address: address || "",
      // Pasar userId para asignación de prospecto
      user_id: req.user?.id || null,
    };

    console.log("[AUTO-ENRICH] Llamando al agente SDR:", agentsSdkUrl + "/api/sdr/initiate-call");
    console.log("[AUTO-ENRICH] Payload:", JSON.stringify(sdrPayload, null, 2));

    // Obtener API Key para autenticación con agentes-crm-sdk
    const sdrApiKey = process.env.SDR_API_KEY;
    if (!sdrApiKey) {
      logger.warn("[AUTO-ENRICH] SDR_API_KEY no configurada - llamada puede fallar");
    }

    const sdrResponse = await axios.post(
      agentsSdkUrl + "/api/sdr/initiate-call",
      sdrPayload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": sdrApiKey || "",
        },
        timeout: 30000,
      }
    );

    console.log("[AUTO-ENRICH] Respuesta del agente SDR:", JSON.stringify(sdrResponse.data, null, 2));

    res.json({
      success: true,
      message: "Llamada SDR iniciada exitosamente",
      sdrResponse: sdrResponse.data,
      receivedData: {
        businessName,
        businessContact,
        employeeRange: employeeRange || "No especificado",
        establishmentId: establishmentId || sdrPayload.establishment_id,
      },
    });
  } catch (error) {
    logger.error("Error en auto-enrich:", error);

    // Si el error es de axios, extraer mensaje
    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        error: `Error del agente SDR: ${error.response.data?.error || error.message}`,
      });
    }

    next(error);
  }
};


module.exports = {
  list,
  getById,
  create,
  update,
  updateStatus,
  track,
  autoEnrich,
};

