const leadService = require("../services/leadService");
const logger = require("../config/logger");
const axios = require("axios");

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

// Función para normalizar teléfono al formato E.164
const normalizePhoneToE164 = (phone) => {
  if (!phone) return null;

  // Limpiar el teléfono de caracteres no numéricos
  let cleaned = phone.replace(/\D/g, '');

  // Si ya tiene código de país (comienza con 52 para México y tiene 12 dígitos)
  if (cleaned.startsWith('52') && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  // Si es un número de 10 dígitos (formato local mexicano)
  if (cleaned.length === 10) {
    return `+52${cleaned}`;
  }

  // Si tiene 11 dígitos y empieza con 1 (podría ser número de celular con 1 al inicio)
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+52${cleaned.substring(1)}`;
  }

  // Si ya tiene el formato correcto con +
  if (phone.startsWith('+') && /^\+[1-9]\d{1,14}$/.test(phone)) {
    return phone;
  }

  // Por defecto, asumir México (+52) si es un número de 10 dígitos
  if (cleaned.length >= 10) {
    return `+52${cleaned.slice(-10)}`;
  }

  // Si no se puede normalizar, devolver el original
  console.warn(`[PHONE NORMALIZATION] No se pudo normalizar el teléfono: ${phone}`);
  return phone;
};

// Enriquecer automáticamente un establecimiento
const autoEnrich = async (req, res, next) => {
  try {
    const {
      businessName,
      businessContact,
      employeeRange,
      establishmentId,
      address,
      agentConfig: requestAgentConfig, // Opcional: objeto de configuración
      agent_config_id: requestAgentConfigId, // Opcional: ID directo
      ab_test_contact_id: abTestContactId,
      voice_id: voiceId,
      prospect_name: prospectName,
      agent_name: agentName,
    } = req.body;

    // Validar datos requeridos
    if (!businessName || !businessContact) {
      return res.status(400).json({
        success: false,
        error: "Se requieren: businessName y businessContact",
      });
    }

    // Normalizar teléfono al formato E.164
    const normalizedPhone = normalizePhoneToE164(businessContact);
    console.log(`[AUTO-ENRICH] Teléfono original: ${businessContact}, normalizado: ${normalizedPhone}`);

    // Registrar los datos recibidos para debugging
    console.log("=== AUTO-ENRICH DATOS RECIBIDOS (PARTNERS API) ===");
    console.log("Nombre del negocio:", businessName);
    console.log("Contacto del negocio:", businessContact);
    console.log("Rango de empleados:", employeeRange || "No especificado");
    console.log("Establishment ID:", establishmentId || "No especificado");
    console.log("Dirección:", address || "No especificada");
    console.log("Usuario (JWT):", req.user?.id);
    console.log("Sales Partner ID:", req.salesPartnerId);
    console.log("==================================================");

    // Verificar si SDR_AGENT_URL está configurado
    const sdrAgentUrl = process.env.SDR_AGENT_URL || process.env.AGENTS_SDK_URL;
    if (!sdrAgentUrl) {
      logger.warn("SDR_AGENT_URL no configurado - solo logging datos");
      return res.json({
        success: true,
        message: "Datos recibidos (SDR_AGENT_URL no configurado)",
        receivedData: {
          businessName,
          businessContact,
          employeeRange: employeeRange || "No especificado",
          establishmentId: establishmentId || "No especificado",
        },
      });
    }

    // Usar agentConfig del request si está presente, sino obtener default
    let agentConfig = null;

    if (requestAgentConfig && requestAgentConfig.id) {
      // Usar agentConfig enviado desde el frontend
      agentConfig = {
        id: requestAgentConfig.id,
        name: requestAgentConfig.name || requestAgentConfig.personality_name,
        openai_voice: requestAgentConfig.openai_voice || "echo",
        voice_speed: parseFloat(requestAgentConfig.voice_speed) || 1.0,
        voice_temperature: parseFloat(requestAgentConfig.voice_temperature) || 1.0,
        voice_intensity: parseInt(requestAgentConfig.voice_intensity) || 1,
        voice_style: requestAgentConfig.voice_style || "professional",
      };
      console.log("[AUTO-ENRICH] ✅ Usando agentConfig del frontend:", agentConfig);
    } else {
      // Obtener configuración de agente default para SDR desde demo-form-service
      try {
        const demoFormUrl = process.env.DEMO_FORM_SERVICE_URL || "http://localhost:3001/api";
        const agentsConfigKey = process.env.AGENTS_CONFIG_KEY;

        const configUrl = `${demoFormUrl}/agent-configs/default/SDR`;
        console.log("[AUTO-ENRICH] 🔍 Fetching agent_config from:", configUrl);
        console.log("[AUTO-ENRICH] 🔑 API Key:", agentsConfigKey ? `${agentsConfigKey.substring(0, 10)}...` : "MISSING");

        const configResponse = await axios.get(
          configUrl,
          {
            headers: {
              "X-API-Key": agentsConfigKey || "",
            },
            timeout: 5000,
          }
        );

        console.log("[AUTO-ENRICH] ✅ Response status:", configResponse.status);
        console.log("[AUTO-ENRICH] 📦 Response data:", JSON.stringify(configResponse.data, null, 2));

        if (configResponse.data?.success && configResponse.data?.data) {
          const data = configResponse.data.data;
          agentConfig = {
            id: data.id,
            name: data.name,
            openai_voice: data.openai_voice || data.voice || "echo",
            voice_speed: data.voice_speed || 1.0,
            voice_temperature: data.voice_temperature || 1.0,
            voice_intensity: data.voice_intensity || 1,
            voice_style: data.voice_style || "professional",
          };
          console.log("[AUTO-ENRICH] ✅ Usando agent_config default:", agentConfig);
        } else {
          console.log("[AUTO-ENRICH] ⚠️ Response no tiene data válida");
        }
      } catch (configError) {
        console.error("[AUTO-ENRICH] ❌ Error completo:", {
          message: configError.message,
          response: configError.response?.data,
          status: configError.response?.status,
          code: configError.code,
        });
        logger.warn("[AUTO-ENRICH] No se pudo obtener agent_config, usando default:", configError.message);
        // Continuar sin agent_config, el SDR usará su default
      }
    }

    // Llamar al agente SDR en agentes-crm-sdk

    // Si viene un ab_test_contact_id pero no trae la voz (porque se disparó manual desde frontend),
    // vamos a buscar la voz de esa variante a la base de datos
    let finalVoiceId = voiceId;
    let finalAgentName = agentName || agentConfig?.name;
    let finalAgentConfigId = requestAgentConfigId || agentConfig?.id;

    if (abTestContactId && !voiceId) {
      try {
        const { PrismaClient } = require("@prisma/client");
        const prisma = new PrismaClient();

        const abTestContact = await prisma.aBTestContact.findUnique({
          where: { id: abTestContactId },
          include: {
            variant: {
              include: {
                personality: true
              }
            }
          }
        });

        if (abTestContact && abTestContact.variant) {
          console.log(`[AUTO-ENRICH] Recuperando config A/B Test para variante ${abTestContact.variant.id}`);
          if (abTestContact.variant.voiceId) {
            finalVoiceId = abTestContact.variant.voiceId;
            console.log(`[AUTO-ENRICH] ✅ Voice ID inyectado desde BD: ${finalVoiceId}`);
          }
          if (abTestContact.variant.personality?.name) {
            finalAgentName = abTestContact.variant.personality.name;
            console.log(`[AUTO-ENRICH] ✅ Agent Name inyectado desde BD: ${finalAgentName}`);
          }
          if (abTestContact.variant.agentConfigId) {
            finalAgentConfigId = abTestContact.variant.agentConfigId;
          }
        }
        await prisma.$disconnect();
      } catch (err) {
        console.error("[AUTO-ENRICH] Error buscando voice_id de variante:", err);
      }
    }

    // Construir payload dinámicamente, omitiendo campos con valor null
    const sdrPayload = {
      establishment_id: establishmentId || `auto-${Date.now()}`,
      establishment_name: businessName,
      phone: normalizedPhone,
      employee_range: employeeRange || "0 a 5 personas",
      address: address || "",
      prospect_name: prospectName || "Contacto",
    };

    // Agregar campos opcionales solo si tienen valor
    if (req.salesPartnerId || req.user?.id) {
      sdrPayload.user_id = req.salesPartnerId || req.user.id;
    }
    if (abTestContactId) {
      sdrPayload.ab_test_contact_id = abTestContactId;
    }
    if (finalVoiceId) {
      sdrPayload.voice_id = finalVoiceId;
    }
    if (finalAgentConfigId) {
      sdrPayload.agent_config_id = finalAgentConfigId;
    }
    if (finalAgentName) {
      sdrPayload.agent_name = finalAgentName;
    }

    console.log("[AUTO-ENRICH] Llamando al agente SDR:", sdrAgentUrl + "/api/sdr/initiate-call");
    console.log("[AUTO-ENRICH] Payload:", JSON.stringify(sdrPayload, null, 2));

    // Obtener API Key para autenticación con agentes-crm-sdk
    const sdrApiKey = process.env.SDR_API_KEY;
    if (!sdrApiKey) {
      logger.warn("[AUTO-ENRICH] SDR_API_KEY no configurada - llamada puede fallar");
    }

    const sdrResponse = await axios.post(
      sdrAgentUrl + "/api/sdr/initiate-call",
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
    logger.error("Error en auto-enrich:", { message: error.message, status: error.response?.status });

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


/**
 * POST /leads/auto-qualify
 * Inicia una llamada de calificación automática para un prospecto
 * 
 * Body:
 * - establishmentId: ID del establecimiento (requerido)
 * - establishmentName: Nombre del negocio (requerido)
 * - decisionMakerName: Nombre del tomador de decisiones (requerido)
 * - decisionMakerPhone: Teléfono del tomador de decisiones (requerido)
 * - decisionMakerPosition: Posición (opcional)
 * - decisionMakerEmail: Email (opcional)
 * 
 * La llamada usa el agente de Qualification para:
 * - Recopilar información BANT
 * - Identificar intent, fear, pain, desire
 * - Agendar demo en Calendly si es necesario
 * - Convertir PROSPECT -> LEAD
 */
const autoQualify = async (req, res, next) => {
  try {
    const {
      establishmentId,
      establishmentName,
      decisionMakerName,
      decisionMakerPhone,
      decisionMakerPosition,
      decisionMakerEmail,
    } = req.body;

    // Validación de campos requeridos
    if (!establishmentId || !establishmentName || !decisionMakerName || !decisionMakerPhone) {
      return res.status(400).json({
        success: false,
        error: "Se requieren establishmentId, establishmentName, decisionMakerName y decisionMakerPhone",
      });
    }

    // Formatear teléfono a E.164 si no tiene el prefijo +
    let formattedPhone = decisionMakerPhone.trim();
    if (!formattedPhone.startsWith('+')) {
      // Si el número empieza con 52, agregar solo el +
      if (formattedPhone.startsWith('52')) {
        formattedPhone = '+' + formattedPhone;
      } else {
        // Si no tiene 52, agregar +52
        formattedPhone = '+52' + formattedPhone;
      }
    }

    console.log("=== AUTO-QUALIFY DATOS RECIBIDOS (PARTNERS API) ===");
    console.log("Nombre del negocio:", establishmentName);
    console.log("Tomador de decisiones:", decisionMakerName);
    console.log("Teléfono original:", decisionMakerPhone);
    console.log("Teléfono formateado:", formattedPhone);
    console.log("Posición:", decisionMakerPosition || "No especificado");
    console.log("Email:", decisionMakerEmail || "No especificado");
    console.log("Establishment ID:", establishmentId);
    console.log("Usuario:", req.salesPartnerId || req.user?.id || "No identificado");
    console.log("===================================================");

    // URL del agente de qualification
    const qualificationAgentUrl = process.env.QUALIFICATION_AGENT_URL || process.env.AGENTS_SDK_URL;
    if (!qualificationAgentUrl) {
      logger.error("[AUTO-QUALIFY] QUALIFICATION_AGENT_URL no configurada");
      return res.status(500).json({
        success: false,
        error: "Servicio de agentes de calificación no configurado",
        details: {
          establishmentName,
          decisionMakerName,
        },
      });
    }

    // Obtener configuración de agente default para QUALIFICATION desde demo-form-service
    let agentConfigId = null;
    try {
      const demoFormUrl = process.env.DEMO_FORM_SERVICE_URL || "http://localhost:3001/api";
      const agentsConfigKey = process.env.AGENTS_CONFIG_KEY;

      const configUrl = `${demoFormUrl}/agent-configs/default/QUALIFICATION`;
      console.log("[AUTO-QUALIFY] 🔍 Fetching agent_config from:", configUrl);

      const configResponse = await axios.get(
        configUrl,
        {
          headers: {
            "X-API-Key": agentsConfigKey || "",
          },
          timeout: 5000,
        }
      );

      if (configResponse.data?.success && configResponse.data?.data) {
        agentConfigId = configResponse.data.data.id;
        console.log("[AUTO-QUALIFY] ✅ Using agent_config_id:", agentConfigId);
      } else {
        console.log("[AUTO-QUALIFY] ⚠️ No default QUALIFICATION config found");
      }
    } catch (configError) {
      console.error("[AUTO-QUALIFY] ❌ Error fetching agent_config:", configError.message);
      logger.warn("[AUTO-QUALIFY] No se pudo obtener agent_config, continuando sin él");
    }

    // Llamar al agente de Qualification en agentes-crm-sdk
    const qualificationPayload = {
      establishment_id: establishmentId,
      business_name: establishmentName,
      phone: formattedPhone,
      prospect_name: decisionMakerName,
      email: decisionMakerEmail || null,
      // Pasar userId para asignación
      user_id: req.salesPartnerId || req.user?.id || null,
      // Agregar agent_config_id si se obtuvo
      ...(agentConfigId && { agent_config_id: agentConfigId }),
      agent_name: null, // Dejamos que el SDR service resuelva el nombre por defecto si no hay contexto A/B
    };

    console.log("[AUTO-QUALIFY] Llamando al agente de Qualification:", qualificationAgentUrl + "/api/qualification/initiate-call");
    console.log("[AUTO-QUALIFY] Payload:", JSON.stringify(qualificationPayload, null, 2));

    // Obtener API Key para autenticación con agentes-crm-sdk
    const sdrApiKey = process.env.SDR_API_KEY;
    if (!sdrApiKey) {
      logger.warn("[AUTO-QUALIFY] SDR_API_KEY no configurada - llamada puede fallar");
    }

    const qualificationResponse = await axios.post(
      qualificationAgentUrl + "/api/qualification/initiate-call",
      qualificationPayload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": sdrApiKey || "",
        },
        timeout: 30000,
      }
    );

    console.log("[AUTO-QUALIFY] Respuesta del agente de Qualification:", JSON.stringify(qualificationResponse.data, null, 2));

    res.json({
      success: true,
      message: "Llamada de calificación iniciada exitosamente",
      qualificationResponse: qualificationResponse.data,
      receivedData: {
        establishmentName,
        decisionMakerName,
        decisionMakerPhone,
        establishmentId,
      },
    });
  } catch (error) {
    // Solo loggear el mensaje para evitar error de estructura circular
    logger.error("Error en auto-qualify:", error.message);

    // Si el error es de axios, extraer mensaje
    if (error.response) {
      console.log("[AUTO-QUALIFY] Error respuesta:", error.response.status, error.response.data);
      return res.status(error.response.status || 500).json({
        success: false,
        error: `Error del agente de Qualification: ${error.response.data?.error || error.response.data?.detail?.error || error.message}`,
      });
    }

    next(error);
  }
};


/**
 * PATCH /leads/:id/email
 * Actualiza el email de un establishment enrichment (para uso de agentes con API key)
 */
const updateEmail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email es requerido",
      });
    }

    console.log(`[UPDATE EMAIL] Updating email for establishment ${id} to: ${email}`);

    // Actualizar en establishment_enrichments usando establishmentId
    const prisma = require("../config/database");
    const updated = await prisma.establishmentEnrichment.updateMany({
      where: { establishmentId: id },
      data: { decisionMakerEmail: email },
    });

    if (updated.count === 0) {
      return res.status(404).json({
        success: false,
        error: "Registro no encontrado",
      });
    }

    console.log(`[UPDATE EMAIL] Updated ${updated.count} record(s)`);

    res.json({
      success: true,
      message: "Email actualizado exitosamente",
      data: { establishmentId: id, email, updatedCount: updated.count },
    });
  } catch (error) {
    logger.error("Error updating email:", error.message);
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
  autoQualify,
  updateEmail,
};

