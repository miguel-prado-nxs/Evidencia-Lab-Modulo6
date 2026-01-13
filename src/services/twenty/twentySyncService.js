/**
 * Twenty Sync Service
 * Orquestador de sincronizacion entre Partners API y Twenty CRM
 * 
 * Responsabilidades:
 * 1. Encolar jobs de sincronizacion (non-blocking)
 * 2. Procesar jobs pendientes
 * 3. Sincronizar pipeline de establecimiento a Twenty
 * 
 * Flujo de pipeline:
 * ESTABLISHMENT -> CONTACT -> PROSPECT -> LEAD -> CLIENT
 */

const prisma = require("../../config/database");
const { PrismaClient: PrismaClientGeo } = require('@prisma/client-geo');
const logger = require("../../config/logger");
const twentyService = require("./twentyService");

const prismaGeo = new PrismaClientGeo();

/**
 * Mapeo de LeadStatus de Partners a estadoLead de Twenty
 * NO se mapea pipelineVentasEasyorder
 */
const LEAD_STATUS_MAP = {
  NEW: "NUEVO",
  CONTACTED: "EN_CONTACTO",
  QUALIFIED: "PROPUESTA_ENVIADA",
  NEGOTIATION: "NEGOCIANDO",
  WON: "GANADO",
  LOST: "PERDIDO",
};

/**
 * Orden de niveles para comparacion
 */
const LEVEL_ORDER = {
  ESTABLISHMENT: 0,
  CONTACT: 1,
  PROSPECT: 2,
  LEAD: 3,
  CLIENT: 4,
};

/**
 * Encola un job de sincronizacion (non-blocking)
 * No falla aunque haya error - el error se registra y el job queda para reintento
 * 
 * @param {Object} params
 * @param {string} params.establishmentId - ID del establecimiento en Partners
 * @param {string} params.partnerId - ID del partner que disparo la accion
 * @param {string} params.reason - Razon del sync (ADD_TO_CONTACTS, CONTACT_TO_PROSPECT, etc)
 */
async function enqueueSync({ establishmentId, partnerId, reason }) {
  if (!twentyService.isEnabled()) {
    logger.debug("[TwentySyncService] Sync deshabilitado - TWENTY_API_KEY no configurada");
    return null;
  }

  try {
    // Verificar si ya existe un job pendiente para este establecimiento
    const existingJob = await prisma.twentySyncJob.findFirst({
      where: {
        establishmentId,
        status: { in: ["PENDING", "PROCESSING"] },
      },
    });

    if (existingJob) {
      logger.info("[TwentySyncService] Job existente encontrado, actualizando reason", {
        establishmentId,
        jobId: existingJob.id,
        oldReason: existingJob.reason,
        newReason: reason,
      });

      // Actualizar el job existente con la nueva razon
      await prisma.twentySyncJob.update({
        where: { id: existingJob.id },
        data: {
          reason,
          partnerId: partnerId || existingJob.partnerId,
          nextRunAt: new Date(),
        },
      });

      return existingJob.id;
    }

    // Crear nuevo job
    const job = await prisma.twentySyncJob.create({
      data: {
        establishmentId,
        partnerId,
        reason,
        status: "PENDING",
        nextRunAt: new Date(),
      },
    });

    logger.info("[TwentySyncService] Job de sync encolado", {
      jobId: job.id,
      establishmentId,
      partnerId,
      reason,
    });

    return job.id;
  } catch (error) {
    // No fallar el request principal - solo loggear
    logger.error("[TwentySyncService] Error encolando sync (no critico)", {
      error: error.message,
      establishmentId,
      partnerId,
      reason,
    });
    return null;
  }
}

/**
 * Procesa jobs pendientes de sincronizacion
 * Diseñado para ser llamado periodicamente por el worker
 * 
 * @param {number} limit - Numero maximo de jobs a procesar
 * @returns {Object} - Resultado del procesamiento
 */
async function processPendingJobs(limit = 10) {
  if (!twentyService.isEnabled()) {
    return { processed: 0, success: 0, failed: 0 };
  }

  try {
    // Obtener jobs pendientes ordenados por nextRunAt
    const jobs = await prisma.twentySyncJob.findMany({
      where: {
        status: "PENDING",
        nextRunAt: { lte: new Date() },
      },
      orderBy: { nextRunAt: "asc" },
      take: limit,
    });

    if (jobs.length === 0) {
      return { processed: 0, success: 0, failed: 0 };
    }

    logger.info(`[TwentySyncService] Procesando ${jobs.length} jobs pendientes`);

    let success = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        // Marcar como procesando
        await prisma.twentySyncJob.update({
          where: { id: job.id },
          data: { status: "PROCESSING" },
        });

        // Ejecutar sincronizacion
        await syncEstablishmentPipelineToTwenty(job.establishmentId, job.partnerId, job.reason);

        // Marcar como completado
        await prisma.twentySyncJob.update({
          where: { id: job.id },
          data: {
            status: "DONE",
            completedAt: new Date(),
          },
        });

        success++;
        logger.info("[TwentySyncService] Job completado exitosamente", {
          jobId: job.id,
          establishmentId: job.establishmentId,
        });
      } catch (error) {
        failed++;
        const newAttempts = job.attempts + 1;
        const maxRetries = 5;

        // Calcular backoff: min(60s * 2^attempts, 1h)
        const backoffSeconds = Math.min(60 * Math.pow(2, newAttempts), 3600);
        const nextRunAt = new Date(Date.now() + backoffSeconds * 1000);

        const newStatus = newAttempts >= maxRetries ? "FAILED" : "PENDING";

        await prisma.twentySyncJob.update({
          where: { id: job.id },
          data: {
            status: newStatus,
            attempts: newAttempts,
            nextRunAt,
            lastError: error.message || String(error),
            lastErrorAt: new Date(),
          },
        });

        logger.error("[TwentySyncService] Error procesando job", {
          jobId: job.id,
          establishmentId: job.establishmentId,
          error: error.message,
          attempts: newAttempts,
          nextRunAt: nextRunAt.toISOString(),
          finalStatus: newStatus,
        });
      }
    }

    return { processed: jobs.length, success, failed };
  } catch (error) {
    logger.error("[TwentySyncService] Error en processPendingJobs", {
      error: error.message,
    });
    return { processed: 0, success: 0, failed: 0 };
  }
}

/**
 * Sincroniza el pipeline de un establecimiento hacia Twenty CRM
 * Esta es la funcion principal que maneja toda la logica de upsert
 * 
 * @param {string} establishmentId - UUID del establecimiento en Partners DB
 * @param {string} partnerId - ID del partner (para logs)
 * @param {string} reason - Razon del sync
 */
async function syncEstablishmentPipelineToTwenty(establishmentId, partnerId, reason) {
  logger.info("[TwentySyncService] Iniciando sync de pipeline", {
    establishmentId,
    partnerId,
    reason,
  });

  // 1. Cargar EstablishmentEnrichment
  const enrichment = await prisma.establishmentEnrichment.findUnique({
    where: { establishmentId },
  });

  if (!enrichment) {
    logger.warn("[TwentySyncService] Enrichment no encontrado", { establishmentId });
    throw new Error(`Enrichment no encontrado para establishmentId: ${establishmentId}`);
  }

  const currentLevel = enrichment.level || "ESTABLISHMENT";
  const establishmentData = enrichment.establishmentData || {};

  logger.info("[TwentySyncService] Datos de enrichment cargados", {
    establishmentId,
    currentLevel,
    hasEstablishmentData: !!establishmentData,
    decisionMakerName: enrichment.decisionMakerName || null,
  });

  // 2. Obtener o crear TwentySyncState
  let syncState = await prisma.twentySyncState.findUnique({
    where: { establishmentId },
  });

  if (!syncState) {
    syncState = await prisma.twentySyncState.create({
      data: { establishmentId },
    });
  }

  const twentyIds = {
    establecimientoId: syncState.twentyEstablecimientoId,
    contactoId: syncState.twentyContactoId,
    prospectoId: syncState.twentyProspectoId,
    opportunityId: syncState.twentyOpportunityId,
    clienteId: syncState.twentyClienteId,
  };

  try {
    // 3. Obtener el clee del establishment desde establishmentData (ya viene incluido)
    const clee = establishmentData.clee || establishmentId;
    
    // 4. SIEMPRE: Upsert Establecimiento (Company) usando clee
    // Pasar también el establishmentId (UUID) como fallback para buscar en BD geo
    twentyIds.establecimientoId = await upsertEstablecimiento(
      clee,
      establishmentData,
      enrichment,
      currentLevel,
      twentyIds.establecimientoId,
      establishmentId // UUID para buscar en BD geo si no se encuentra por clee
    );

    // 5. Procesar SOLO el nivel actual (no todos los anteriores)
    // Los registros anteriores se eliminan al avanzar de nivel
    
    if (currentLevel === "CONTACT") {
      // Nivel CONTACT: Solo crear/actualizar Person
      twentyIds.contactoId = await upsertContacto(
        establishmentData,
        enrichment,
        twentyIds.establecimientoId,
        twentyIds.contactoId
      );
    } 
    else if (currentLevel === "PROSPECT") {
      // Nivel PROSPECT: Crear Prospecto y eliminar Contacto anterior
      twentyIds.prospectoId = await upsertProspecto(
        establishmentId,
        establishmentData,
        enrichment,
        twentyIds.establecimientoId,
        twentyIds.contactoId,
        twentyIds.prospectoId,
        partnerId
      );
      // El upsertProspecto ya elimina el contacto, solo limpiamos el ID
      twentyIds.contactoId = null;
    } 
    else if (currentLevel === "LEAD") {
      // Nivel LEAD: Crear Opportunity y eliminar Prospecto anterior
      twentyIds.opportunityId = await upsertOpportunity(
        establishmentData,
        enrichment,
        twentyIds.establecimientoId,
        twentyIds.prospectoId,
        twentyIds.opportunityId,
        null
      );
      // El upsertOpportunity ya elimina el prospecto, solo limpiamos el ID
      twentyIds.prospectoId = null;
    } 
    else if (currentLevel === "CLIENT") {
      // Nivel CLIENT: Crear Cliente y eliminar Opportunity anterior
      twentyIds.clienteId = await upsertCliente(
        establishmentData,
        enrichment,
        twentyIds.establecimientoId,
        twentyIds.opportunityId,
        twentyIds.clienteId
      );
      // El upsertCliente ya elimina el opportunity, solo limpiamos el ID
      twentyIds.opportunityId = null;
    }

    // 6. Actualizar TwentySyncState
    await prisma.twentySyncState.update({
      where: { establishmentId },
      data: {
        twentyEstablecimientoId: twentyIds.establecimientoId,
        twentyContactoId: twentyIds.contactoId,
        twentyProspectoId: twentyIds.prospectoId,
        twentyOpportunityId: twentyIds.opportunityId,
        twentyClienteId: twentyIds.clienteId,
        lastSyncedLevel: currentLevel,
        lastSyncedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      },
    });

    logger.info("[TwentySyncService] Sync completado exitosamente", {
      establishmentId,
      partnerId,
      currentLevel,
      twentyIds,
    });

    return twentyIds;
  } catch (error) {
    // Guardar error en syncState
    await prisma.twentySyncState.update({
      where: { establishmentId },
      data: {
        lastError: error.message || String(error),
        lastErrorAt: new Date(),
      },
    });

    throw error;
  }
}

/**
 * Upsert de Establecimiento (Company) en Twenty
 * 
 * Si el establecimiento no existe en Twenty, lo crea usando datos de la BD geo (DENUE).
 * Si existe, solo actualiza nivelPipeline.
 * 
 * @param {string} clee - Clave DENUE del establecimiento (para buscar en Twenty)
 * @param {string} establishmentIdUuid - UUID del establecimiento en BD local
 */
async function upsertEstablecimiento(clee, establishmentData, enrichment, currentLevel, existingId, establishmentIdUuid) {
  // Solo actualizar nivelPipeline
  const updateData = {
    nivelPipeline: currentLevel,
  };

  // Si ya tenemos el ID de Twenty, actualizar directamente
  if (existingId) {
    await twentyService.updateEstablecimiento(existingId, updateData);
    logger.info("[TwentySyncService] Company actualizado (nivelPipeline)", {
      twentyId: existingId,
      nivelPipeline: currentLevel,
    });
    return existingId;
  }

  // Buscar por claveDenue
  let existing = null;
  if (clee) {
    existing = await twentyService.findEstablecimientoByClaveDenue(clee);
  }

  if (existing) {
    await twentyService.updateEstablecimiento(existing.id, updateData);
    logger.info("[TwentySyncService] Company encontrado y actualizado (nivelPipeline)", {
      twentyId: existing.id,
      claveDenue: clee,
      nivelPipeline: currentLevel,
    });
    return existing.id;
  }

  // El establecimiento NO existe en Twenty - crearlo usando datos de BD geo
  logger.warn("[TwentySyncService] Establecimiento NO encontrado en Twenty, creándolo desde BD geo", {
    claveDenue: clee,
    establishmentId: establishmentIdUuid,
  });
  
  try {
    // Obtener datos completos del establecimiento de la BD geo
    const establishment = await prismaGeo.establishment.findFirst({
      where: {
        OR: [
          { clee: clee },
          { id: establishmentIdUuid }
        ]
      }
    });
    
    if (!establishment) {
      throw new Error(`Establecimiento no encontrado en BD geo: clee=${clee}, id=${establishmentIdUuid}`);
    }
    
    // Preparar dirección
    const addressParts = [
      establishment.streetType,
      establishment.streetName,
      establishment.exteriorNum,
      establishment.interiorNum
    ].filter(Boolean);
    
    const addressStreet = addressParts.join(' ') || 'Sin dirección';
    const addressCity = establishment.municipalityName || establishment.stateName || 'Sin ciudad';

    // Preparar datos para Twenty (usando upsert=true)
    const companyData = {
      name: establishment.name || 'Sin nombre',
      claveDenue: establishment.clee,
      nivelPipeline: currentLevel,
      
      // Dirección
      address: {
        addressStreet1: addressStreet,
        addressCity: addressCity,
        addressState: establishment.stateName || '',
        addressPostcode: establishment.postalCode || '',
        addressCountry: 'México'
      },
      
      // Ubicación
      estado: establishment.stateName,
      municipio: establishment.municipalityName,
      codigoPostal: establishment.postalCode || '',
      latitud: establishment.latitude,
      longitud: establishment.longitude,
      
      // Actividad económica
      giro: establishment.activityName || establishment.activityCode || '',
      
      // Contacto (si existe)
      telefonoDenue: establishment.phone ? {
        primaryPhoneNumber: establishment.phone,
        primaryPhoneCountryCode: '+52'
      } : undefined,
      
      emailDenue: establishment.email ? {
        primaryEmail: establishment.email
      } : undefined,
      
      websiteDenue: establishment.website ? {
        primaryLinkUrl: establishment.website,
        primaryLinkLabel: establishment.website
      } : undefined,
      
      // Metadata
      fechaAltaDenue: establishment.addedDate || new Date().toISOString(),
      
      // Dominio para deduplicación
      dominio: establishment.website 
        ? new URL(establishment.website).hostname.replace('www.', '')
        : establishment.name.toLowerCase().replace(/\s+/g, '-').substring(0, 50)
    };

    const response = await twentyService.client.post('/companies?upsert=true', companyData);
    const created = response.data.data?.createCompany || response.data;
    
    logger.info("[TwentySyncService] Establecimiento creado en Twenty desde BD geo", {
      twentyId: created.id,
      claveDenue: establishment.clee,
      name: establishment.name,
      nivelPipeline: currentLevel
    });
    
    return created.id;
    
  } catch (error) {
    logger.error("[TwentySyncService] Error creando establecimiento en Twenty desde BD geo", {
      error: error.response?.data || error.message,
      claveDenue: clee,
      establishmentId: establishmentIdUuid,
    });
    throw error;
  }
}

/**
 * Upsert de Contacto en Twenty
 */
async function upsertContacto(establishmentData, enrichment, establecimientoId, existingId, useDecisionMakerData = false) {
  // Determinar phone y email a usar
  let phone = establishmentData.phone;
  let email = establishmentData.email;

  if (useDecisionMakerData || (!phone && !email)) {
    phone = phone || enrichment.decisionMakerPhone || enrichment.decisionMakerWhatsApp;
    email = email || enrichment.decisionMakerEmail;
  }

  const name = establishmentData.name || enrichment.decisionMakerName || "Sin nombre";

  const contactoData = {
    name,
    fuenteDelDato: "DENUE",
    establecimientoId,
  };

  // Formatear telefono - agregar codigo de pais Mexico si es necesario
  if (phone) {
    let formattedPhone = String(phone).replace(/\D/g, ""); // Solo digitos
    // Si tiene 10 digitos, es telefono mexicano sin codigo de pais
    if (formattedPhone.length === 10) {
      formattedPhone = "+52" + formattedPhone;
    } else if (formattedPhone.length === 12 && formattedPhone.startsWith("52")) {
      formattedPhone = "+" + formattedPhone;
    } else if (!formattedPhone.startsWith("+")) {
      formattedPhone = "+" + formattedPhone;
    }
    contactoData.telefonoPrincipal = { 
      primaryPhoneNumber: formattedPhone,
      primaryPhoneCountryCode: "MX",
      primaryPhoneCallingCode: "+52"
    };
  }

  if (email) {
    contactoData.emailPrincipal = { primaryEmail: email };
  }

  let contactoId = null;
  if (existingId) {
    await twentyService.updateContacto(existingId, contactoData);
    contactoId = existingId;
  } else {
    let existing = await twentyService.findContactoByEstablecimientoId(establecimientoId);
    if (!existing && email) {
      existing = await twentyService.findContactoByEmail(email);
    }
    if (!existing && phone) {
      existing = await twentyService.findContactoByPhone(phone);
    }
    if (existing) {
      await twentyService.updateContacto(existing.id, contactoData);
      contactoId = existing.id;
    } else {
      const created = await twentyService.createContacto(contactoData);
      contactoId = created.id;
    }
  }
  // No hay pipeline anterior a eliminar para contacto
  return contactoId;
}

/**
 * Upsert de Prospecto en Twenty
 */
/**
 * Mapeo de posiciones a valores del ENUM de Twenty
 */
const TOMADOR_CARGO_MAP = {
  'dueño': 'DUENO',
  'dueno': 'DUENO',
  'gerente': 'GERENTE',
  'encargado': 'ENCARGADO',
  'administrador': 'ADMINISTRADOR',
  'socio': 'SOCIO',
  'otro': 'OTRO',
};

/**
 * Upsert de Prospecto en Twenty
 */
async function upsertProspecto(establishmentId, establishmentData, enrichment, establecimientoId, contactoId, existingId, partnerId) {
  const name = establishmentData.name || enrichment.decisionMakerName || "Sin nombre";

  const prospectoData = {
    name, // Nombre del establecimiento
    establecimientoId, // Relación con Company
  };

  // Fecha de identificación (cuándo se enriqueció)
  if (enrichment.enrichedAt) {
    prospectoData.fechaIdentificacion = enrichment.enrichedAt;
  }

  // Buscar mejor horario de contacto en sdr_interactions
  /*const sdrInteraction = await prisma.sdrInteraction.findFirst({
    where: { 
      establishmentId,
      callSummary: { contains: 'Mejor horario', mode: 'insensitive' }
    },
    select: { callSummary: true },
    orderBy: { createdAt: 'desc' }
  });
  
  if (sdrInteraction && sdrInteraction.callSummary) {
    // Extraer el texto después de "Mejor horario"
    const match = sdrInteraction.callSummary.match(/Mejor horario[:\s]*(.*?)(?:\n|\.|$)/i);
    if (match && match[1]) {
      prospectoData.mejorHorarioContacto = match[1].trim();
    }
  }*/

  // Buscar notas en lead_prospects
  const leadProspect = await prisma.leadProspect.findFirst({
    where: { establishmentId },
    select: { notes: true }
  });
  if (leadProspect && leadProspect.notes) {
    prospectoData.notasProspecto = leadProspect.notes;
  }

  // NOTA: NO incluir contactoId - el modelo Prospecto en Twenty no tiene ese campo
  // El contacto se elimina después de crear el prospecto (ver final de la función)

  // Nombre del tomador
  if (enrichment.decisionMakerName) {
    prospectoData.tomadorNombre = enrichment.decisionMakerName;
  }

  // Cargo del tomador - mapear a ENUM
  let tomadorCargo = null;
  if (enrichment.decisionMakerPosition) {
    const cargoLower = enrichment.decisionMakerPosition.toLowerCase();
    tomadorCargo = TOMADOR_CARGO_MAP[cargoLower] || 'OTRO';
    prospectoData.tomadorCargo = tomadorCargo;
  }

  // Es Gatekeeper: false si es DUENO o GERENTE
  if (tomadorCargo === 'DUENO' || tomadorCargo === 'GERENTE') {
    prospectoData.esGatekeeper = false;
  }

  // Fuente Identificación: el partner que agregó el prospecto
  if (enrichment.enrichedBy) {
    prospectoData.fuenteIdentificacion = enrichment.enrichedBy;
  }

  // Email del tomador
  if (enrichment.decisionMakerEmail) {
    prospectoData.tomadorEmail = { primaryEmail: enrichment.decisionMakerEmail };
  }

  // WhatsApp del tomador
  if (enrichment.decisionMakerWhatsApp) {
    let phone = String(enrichment.decisionMakerWhatsApp).replace(/\D/g, "");
    if (phone.length === 10) {
      phone = "+52" + phone;
    } else if (phone.length === 12 && phone.startsWith("52")) {
      phone = "+" + phone;
    } else if (!phone.startsWith("+")) {
      phone = "+" + phone;
    }
    prospectoData.tomadorWhatsapp = { 
      primaryPhoneNumber: phone,
      primaryPhoneCountryCode: "MX",
      primaryPhoneCallingCode: "+52"
    };
  }

  // Teléfono directo del tomador
  if (enrichment.decisionMakerPhone) {
    let phone = String(enrichment.decisionMakerPhone).replace(/\D/g, "");
    if (phone.length === 10) {
      phone = "+52" + phone;
    } else if (phone.length === 12 && phone.startsWith("52")) {
      phone = "+" + phone;
    } else if (!phone.startsWith("+")) {
      phone = "+" + phone;
    }
    prospectoData.tomadorTelefonoDirecto = { 
      primaryPhoneNumber: phone,
      primaryPhoneCountryCode: "MX",
      primaryPhoneCallingCode: "+52"
    };
  }

  let prospectoId = null;
  if (existingId) {
    await twentyService.updateProspecto(existingId, prospectoData);
    prospectoId = existingId;
  } else {
    let existing = null;
    if (enrichment.decisionMakerEmail) {
      existing = await twentyService.findProspectoByEmail(enrichment.decisionMakerEmail);
    }
    if (existing) {
      await twentyService.updateProspecto(existing.id, prospectoData);
      prospectoId = existing.id;
    } else {
      const created = await twentyService.createProspecto(prospectoData);
      prospectoId = created.id;
    }
  }
  // IMPORTANTE: Eliminar el contacto anterior (Person) ya que ahora es prospecto
  if (contactoId) {
    try {
      await twentyService.deleteContacto(contactoId);
      logger.info("[TwentySyncService] Contacto eliminado después de crear prospecto", {
        contactoId,
        prospectoId: prospectoId
      });
    } catch (error) {
      logger.warn("[TwentySyncService] Error eliminando contacto anterior (no crítico)", {
        contactoId,
        error: error.message
      });
    }
  }
  return prospectoId;
}

/**
 * Upsert de Opportunity (Lead) en Twenty
 */
async function upsertOpportunity(establishmentData, enrichment, establecimientoId, prospectoId, existingId, leadStatus) {
  const name = establishmentData.name || enrichment.decisionMakerName || "Sin nombre";
  const decisionMakerName = enrichment.decisionMakerName || "";

  const opportunityData = {
    name: `Lead - ${name}${decisionMakerName ? ` - ${decisionMakerName}` : ""}`,
    establecimientoId,
    estadoLead: "NUEVO", // Estado inicial
    pipelineVentasEasyorder: "DISCOVERY", // Etapa inicial del pipeline
    prioridad: "B_WARM", // Prioridad por defecto
  };

  // NO incluir prospectoId porque el prospecto se eliminará

  // Datos de cualificación (IFPD)
  if (enrichment.intent) {
    opportunityData.intent = enrichment.intent;
  }
  if (enrichment.fear) {
    opportunityData.fear = enrichment.fear;
  }
  if (enrichment.pain) {
    opportunityData.pain = enrichment.pain;
  }
  if (enrichment.desire) {
    opportunityData.desire = enrichment.desire;
  }

  let opportunityId = null;
  if (existingId) {
    await twentyService.updateOpportunity(existingId, opportunityData);
    opportunityId = existingId;
  } else {
    let existing = await twentyService.findOpportunityByEstablecimientoId(establecimientoId);
    if (existing) {
      await twentyService.updateOpportunity(existing.id, opportunityData);
      opportunityId = existing.id;
    } else {
      const created = await twentyService.createOpportunity(opportunityData);
      opportunityId = created.id;
    }
  }
  // IMPORTANTE: Eliminar el prospecto anterior ya que ahora es lead
  if (prospectoId) {
    try {
      await twentyService.deleteProspecto(prospectoId);
      logger.info("[TwentySyncService] Prospecto eliminado después de crear opportunity", {
        prospectoId,
        opportunityId: opportunityId
      });
    } catch (error) {
      logger.warn("[TwentySyncService] Error eliminando prospecto anterior (no crítico)", {
        prospectoId,
        error: error.message
      });
    }
  }
  return opportunityId;
}

/**
 * Upsert de Cliente en Twenty
 */
async function upsertCliente(establishmentData, enrichment, establecimientoId, opportunityId, existingId) {
  const name = establishmentData.name || enrichment.decisionMakerName || "Sin nombre";

  // Mapeo de estatusCliente - normalizar a mayúsculas
  let estatusCliente = "ACTIVO"; // Default
  if (enrichment.clientStatus) {
    const statusMap = {
      ACTIVO: "ACTIVO",
      INACTIVO: "INACTIVO",
      CHURNED: "CHURNED",
      SUSPENDIDO: "SUSPENDIDO",
    };
    estatusCliente = statusMap[enrichment.clientStatus.toUpperCase()] || "ACTIVO";
  }

  const clienteData = {
    name,
    establecimientoId,
    estatusCliente,
  };

  // NO incluir leadId porque el opportunity se eliminará

  // Producto adquirido - mapear a enum con variantes
  if (enrichment.productPurchased) {
    const productValue = enrichment.productPurchased.trim().toLowerCase();
    const productMap = {
      starter: "STARTER",
      "plan starter": "STARTER",
      "plan básico": "STARTER",
      "plan basico": "STARTER",
      basic: "STARTER",
      "starter pos": "STARTER",
      "pos starter": "STARTER",
      growth: "GROWTH",
      "plan growth": "GROWTH",
      "growth pos": "GROWTH",
      "pos growth": "GROWTH",
      premium: "PREMIUM",
      "plan premium": "PREMIUM",
      "premium pos": "PREMIUM",
      "pos premium": "PREMIUM",
      "pos terminal premium": "PREMIUM",
      "terminal premium": "PREMIUM",
      "pos terminal": "PREMIUM",
      "terminal": "PREMIUM",
      avanzado: "PREMIUM",
      "plan avanzado": "PREMIUM",
      profesional: "PREMIUM",
      "plan profesional": "PREMIUM",
      enterprise: "ENTERPRISE",
      "plan enterprise": "ENTERPRISE",
      "enterprise pos": "ENTERPRISE",
      "pos enterprise": "ENTERPRISE",
    };
    clienteData.productoAdquirido = productMap[productValue] || "OTRO";
  }

  // Monto primera compra
  if (enrichment.purchaseAmount) {
    clienteData.montoPrimeraCompra = {
      amountMicros: Math.round(parseFloat(enrichment.purchaseAmount) * 1000000),
      currencyCode: "MXN"
    };
  }

  // Cliente desde
  if (enrichment.clientSince) {
    clienteData.clienteDesde = new Date(enrichment.clientSince).toISOString();
  } else if (enrichment.purchaseDate) {
    clienteData.clienteDesde = new Date(enrichment.purchaseDate).toISOString();
  }

  // Notas del cliente
  if (enrichment.clientNotes) {
    clienteData.notasDeCliente = enrichment.clientNotes;
  }

  let clienteId = null;
  // Si ya existe en Twenty, actualizar
  if (existingId) {
    await twentyService.updateCliente(existingId, clienteData);
    clienteId = existingId;
  } else {
    // Buscar por establecimientoId
    let existing = await twentyService.findClienteByEstablecimientoId(establecimientoId);
    if (existing) {
      await twentyService.updateCliente(existing.id, clienteData);
      clienteId = existing.id;
    } else {
      // Crear nuevo
      const created = await twentyService.createCliente(clienteData);
      clienteId = created.id;
    }
  }

  // IMPORTANTE: Eliminar el opportunity anterior ya que ahora es cliente
  if (opportunityId) {
    try {
      await twentyService.deleteOpportunity(opportunityId);
      logger.info("[TwentySyncService] Opportunity eliminado después de crear cliente", {
        opportunityId,
        clienteId: clienteId
      });
    } catch (error) {
      logger.warn("[TwentySyncService] Error eliminando opportunity anterior (no crítico)", {
        opportunityId,
        error: error.message
      });
    }
  }
  return clienteId;
}

/**
 * Actualiza el estadoLead de una opportunity existente
 * Usado cuando se actualiza el status de un Lead en Partners
 */
async function updateOpportunityStatus(establishmentId, leadStatus) {
  if (!twentyService.isEnabled()) {
    return null;
  }

  try {
    const syncState = await prisma.twentySyncState.findUnique({
      where: { establishmentId },
    });

    if (!syncState?.twentyOpportunityId) {
      logger.warn("[TwentySyncService] No hay opportunity mapeada para actualizar estadoLead", {
        establishmentId,
      });
      return null;
    }

    const estadoLead = LEAD_STATUS_MAP[leadStatus];
    if (!estadoLead) {
      logger.warn("[TwentySyncService] LeadStatus no mapeado", { leadStatus });
      return null;
    }

    await twentyService.updateOpportunity(syncState.twentyOpportunityId, {
      estadoLead,
    });

    logger.info("[TwentySyncService] Opportunity estadoLead actualizado", {
      establishmentId,
      opportunityId: syncState.twentyOpportunityId,
      estadoLead,
    });

    return syncState.twentyOpportunityId;
  } catch (error) {
    logger.error("[TwentySyncService] Error actualizando opportunity status", {
      error: error.message,
      establishmentId,
      leadStatus,
    });
    return null;
  }
}

/**
 * Obtiene estadisticas de sync
 */
async function getSyncStats() {
  const [pending, processing, done, failed] = await Promise.all([
    prisma.twentySyncJob.count({ where: { status: "PENDING" } }),
    prisma.twentySyncJob.count({ where: { status: "PROCESSING" } }),
    prisma.twentySyncJob.count({ where: { status: "DONE" } }),
    prisma.twentySyncJob.count({ where: { status: "FAILED" } }),
  ]);

  const totalSyncStates = await prisma.twentySyncState.count();
  const synced = await prisma.twentySyncState.count({
    where: { lastSyncedAt: { not: null } },
  });

  return {
    jobs: { pending, processing, done, failed },
    syncStates: { total: totalSyncStates, synced },
    enabled: twentyService.isEnabled(),
  };
}

module.exports = {
  enqueueSync,
  processPendingJobs,
  syncEstablishmentPipelineToTwenty,
  updateOpportunityStatus,
  getSyncStats,
  LEAD_STATUS_MAP,
};
