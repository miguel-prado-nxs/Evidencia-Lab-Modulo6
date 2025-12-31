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
const logger = require("../../config/logger");
const twentyService = require("./twentyService");

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
 * @param {string} establishmentId - ID del establecimiento en Partners
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
    // 3. SIEMPRE: Upsert Establecimiento (Company)
    twentyIds.establecimientoId = await upsertEstablecimiento(
      establishmentId,
      establishmentData,
      enrichment,
      currentLevel,
      twentyIds.establecimientoId
    );

    // 4. Si currentLevel >= CONTACT: Upsert Contacto (si hay phone o email)
    if (LEVEL_ORDER[currentLevel] >= LEVEL_ORDER.CONTACT) {
      twentyIds.contactoId = await upsertContacto(
        establishmentData,
        enrichment,
        twentyIds.establecimientoId,
        twentyIds.contactoId
      );
    }

    // 5. Si currentLevel >= PROSPECT: Upsert Prospecto
    if (LEVEL_ORDER[currentLevel] >= LEVEL_ORDER.PROSPECT) {
      // Si no hay contacto pero ahora si hay phone/email del tomador, crear contacto primero
      if (!twentyIds.contactoId) {
        const decisionMakerPhone = enrichment.decisionMakerPhone || enrichment.decisionMakerWhatsApp;
        const decisionMakerEmail = enrichment.decisionMakerEmail;

        if (decisionMakerPhone || decisionMakerEmail) {
          logger.info("[TwentySyncService] Creando contacto desde datos del tomador de decisiones", {
            establishmentId,
          });

          twentyIds.contactoId = await upsertContacto(
            establishmentData,
            enrichment,
            twentyIds.establecimientoId,
            null,
            true // useDecisionMakerData
          );
        }
      }

      twentyIds.prospectoId = await upsertProspecto(
        enrichment,
        twentyIds.establecimientoId,
        twentyIds.contactoId,
        twentyIds.prospectoId
      );
    }

    // 6. Si currentLevel >= LEAD: Upsert Opportunity
    if (LEVEL_ORDER[currentLevel] >= LEVEL_ORDER.LEAD) {
      // Intentar obtener el LeadStatus del lead asociado
      let leadStatus = null;
      const lead = await prisma.lead.findFirst({
        where: {
          notes: { contains: `ID Establecimiento: ${establishmentId}` },
        },
      });

      if (lead) {
        leadStatus = lead.status;
      }

      twentyIds.opportunityId = await upsertOpportunity(
        establishmentData,
        enrichment,
        twentyIds.establecimientoId,
        twentyIds.prospectoId,
        twentyIds.opportunityId,
        leadStatus
      );
    }

    // 7. Si currentLevel >= CLIENT: Upsert Cliente
    if (LEVEL_ORDER[currentLevel] >= LEVEL_ORDER.CLIENT) {
      twentyIds.clienteId = await upsertCliente(
        establishmentData,
        enrichment,
        twentyIds.establecimientoId,
        twentyIds.opportunityId,
        twentyIds.clienteId
      );

      // Actualizar opportunity.estadoLead a GANADO
      if (twentyIds.opportunityId) {
        try {
          await twentyService.updateOpportunity(twentyIds.opportunityId, {
            estadoLead: "GANADO",
          });
          logger.info("[TwentySyncService] Opportunity actualizada a GANADO", {
            opportunityId: twentyIds.opportunityId,
          });
        } catch (error) {
          logger.warn("[TwentySyncService] Error actualizando opportunity a GANADO", {
            error: error.message,
          });
        }
      }
    }

    // 8. Actualizar TwentySyncState
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
 * Usa los campos personalizados configurados en Twenty CRM
 */
async function upsertEstablecimiento(establishmentId, establishmentData, enrichment, currentLevel, existingId) {
  const name = establishmentData.name || enrichment.decisionMakerName || "Sin nombre";

  const companyData = {
    name,
    nivelPipeline: currentLevel,
  };

  // Clave DENUE (ID del establecimiento)
  if (establishmentId) {
    companyData.claveDenue = establishmentId;
  }

  // Telefono DENUE - formatear con codigo de pais
  if (establishmentData.phone) {
    let formattedPhone = String(establishmentData.phone).replace(/\D/g, "");
    if (formattedPhone.length === 10) {
      formattedPhone = "+52" + formattedPhone;
    } else if (formattedPhone.length === 12 && formattedPhone.startsWith("52")) {
      formattedPhone = "+" + formattedPhone;
    } else if (!formattedPhone.startsWith("+")) {
      formattedPhone = "+" + formattedPhone;
    }
    companyData.telefonoDenue = { 
      primaryPhoneNumber: formattedPhone,
      primaryPhoneCountryCode: "MX",
      primaryPhoneCallingCode: "+52"
    };
  }

  // Email DENUE
  if (establishmentData.email) {
    companyData.emailDenue = { primaryEmail: establishmentData.email };
  }

  // Website DENUE
  if (establishmentData.website) {
    companyData.websiteDenue = { primaryLinkUrl: establishmentData.website, primaryLinkLabel: establishmentData.website };
    // Tambien en domainName estandar
    companyData.domainName = { primaryLinkUrl: establishmentData.website, primaryLinkLabel: establishmentData.website };
  }

  // Giro/Actividad economica
  if (establishmentData.activity_name) {
    companyData.giro = establishmentData.activity_name;
  }

  // Estado
  if (establishmentData.state_name) {
    companyData.estado = establishmentData.state_name;
  }

  // Municipio
  if (establishmentData.municipality_name) {
    companyData.municipio = establishmentData.municipality_name;
  }

  // Codigo Postal
  if (establishmentData.codigo_postal) {
    companyData.codigoPostal = establishmentData.codigo_postal;
  }

  // Latitud y Longitud
  if (establishmentData.latitude) {
    companyData.latitud = parseFloat(establishmentData.latitude);
  }
  if (establishmentData.longitude) {
    companyData.longitud = parseFloat(establishmentData.longitude);
  }

  // Address (campo estandar de Twenty)
  const addressParts = {};
  if (establishmentData.street) addressParts.addressStreet1 = establishmentData.street;
  if (establishmentData.municipality_name) addressParts.addressCity = establishmentData.municipality_name;
  if (establishmentData.state_name) addressParts.addressState = establishmentData.state_name;
  if (establishmentData.codigo_postal) addressParts.addressPostcode = establishmentData.codigo_postal;
  addressParts.addressCountry = "Mexico";
  if (establishmentData.latitude) addressParts.addressLat = parseFloat(establishmentData.latitude);
  if (establishmentData.longitude) addressParts.addressLng = parseFloat(establishmentData.longitude);

  if (Object.keys(addressParts).length > 1) {
    companyData.address = addressParts;
  }

  // Si ya existe en Twenty, actualizar
  if (existingId) {
    await twentyService.updateEstablecimiento(existingId, companyData);
    return existingId;
  }

  // Buscar por claveDenue primero (deduplicacion mas precisa)
  let existing = null;
  if (establishmentId) {
    existing = await twentyService.findEstablecimientoByClaveDenue(establishmentId);
  }
  // Si no se encontro por clave, buscar por email
  if (!existing && establishmentData.email) {
    existing = await twentyService.findEstablecimientoByEmail(establishmentData.email);
  }
  // Si no se encontro por email, buscar por telefono
  if (!existing && establishmentData.phone) {
    existing = await twentyService.findEstablecimientoByPhone(establishmentData.phone);
  }

  if (existing) {
    await twentyService.updateEstablecimiento(existing.id, companyData);
    return existing.id;
  }

  // Crear nuevo
  const created = await twentyService.createEstablecimiento(companyData);
  return created.id;
}

/**
 * Upsert de Contacto en Twenty
 * IMPORTANTE: NO crear contacto si no hay phone ni email
 */
async function upsertContacto(establishmentData, enrichment, establecimientoId, existingId, useDecisionMakerData = false) {
  // Determinar phone y email a usar
  let phone = establishmentData.phone;
  let email = establishmentData.email;

  if (useDecisionMakerData || (!phone && !email)) {
    phone = phone || enrichment.decisionMakerPhone || enrichment.decisionMakerWhatsApp;
    email = email || enrichment.decisionMakerEmail;
  }

  // Validar que hay al menos phone o email
  if (!phone && !email) {
    logger.info("[TwentySyncService] Omitiendo creacion de contacto - sin phone ni email", {
      establecimientoId,
    });
    return existingId || null;
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

  // Si ya existe en Twenty, actualizar
  if (existingId) {
    await twentyService.updateContacto(existingId, contactoData);
    return existingId;
  }

  // Buscar por establecimientoId
  let existing = await twentyService.findContactoByEstablecimientoId(establecimientoId);

  // Si no se encontro, buscar por email o telefono
  if (!existing && email) {
    existing = await twentyService.findContactoByEmail(email);
  }
  if (!existing && phone) {
    existing = await twentyService.findContactoByPhone(phone);
  }

  if (existing) {
    await twentyService.updateContacto(existing.id, contactoData);
    return existing.id;
  }

  // Crear nuevo
  const created = await twentyService.createContacto(contactoData);
  return created.id;
}

/**
 * Upsert de Prospecto en Twenty
 */
async function upsertProspecto(enrichment, establecimientoId, contactoId, existingId) {
  const prospectoData = {
    establecimientoId,
  };

  // Datos del tomador de decisiones
  if (enrichment.decisionMakerName) {
    prospectoData.tomadorNombre = enrichment.decisionMakerName;
  }

  if (enrichment.decisionMakerPosition) {
    prospectoData.tomadorCargo = enrichment.decisionMakerPosition;
  }

  const phone = enrichment.decisionMakerPhone || enrichment.decisionMakerWhatsApp;
  if (phone) {
    prospectoData.tomadorTelefono = { primaryPhoneNumber: phone };
  }

  if (enrichment.decisionMakerEmail) {
    prospectoData.tomadorEmail = { primaryEmail: enrichment.decisionMakerEmail };
  }

  if (contactoId) {
    prospectoData.contactoId = contactoId;
  }

  // Si ya existe en Twenty, actualizar
  if (existingId) {
    await twentyService.updateProspecto(existingId, prospectoData);
    return existingId;
  }

  // Buscar por establecimientoId
  let existing = await twentyService.findProspectoByEstablecimientoId(establecimientoId);

  // Si no se encontro, buscar por email
  if (!existing && enrichment.decisionMakerEmail) {
    existing = await twentyService.findProspectoByEmail(enrichment.decisionMakerEmail);
  }

  if (existing) {
    await twentyService.updateProspecto(existing.id, prospectoData);
    return existing.id;
  }

  // Crear nuevo
  const created = await twentyService.createProspecto(prospectoData);
  return created.id;
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
  };

  if (prospectoId) {
    opportunityData.prospectoId = prospectoId;
  }

  // Mapear estadoLead - NO incluir pipelineVentasEasyorder
  if (leadStatus && LEAD_STATUS_MAP[leadStatus]) {
    opportunityData.estadoLead = LEAD_STATUS_MAP[leadStatus];
  }

  // Si ya existe en Twenty, actualizar
  if (existingId) {
    await twentyService.updateOpportunity(existingId, opportunityData);
    return existingId;
  }

  // Buscar por establecimientoId
  let existing = await twentyService.findOpportunityByEstablecimientoId(establecimientoId);

  if (existing) {
    await twentyService.updateOpportunity(existing.id, opportunityData);
    return existing.id;
  }

  // Crear nuevo
  const created = await twentyService.createOpportunity(opportunityData);
  return created.id;
}

/**
 * Upsert de Cliente en Twenty
 */
async function upsertCliente(establishmentData, enrichment, establecimientoId, opportunityId, existingId) {
  const name = establishmentData.name || enrichment.decisionMakerName || "Sin nombre";

  const clienteData = {
    name,
    establecimientoId,
    estatusCliente: enrichment.clientStatus || "ACTIVO",
  };

  if (opportunityId) {
    clienteData.leadId = opportunityId;
  }

  // Producto adquirido - mapear a enum si es posible
  if (enrichment.productPurchased) {
    const productMap = {
      STARTER: "STARTER",
      GROWTH: "GROWTH",
      PREMIUM: "PREMIUM",
      ENTERPRISE: "ENTERPRISE",
    };
    clienteData.productoAdquirido = productMap[enrichment.productPurchased.toUpperCase()] || "OTRO";
  }

  // Monto primera compra
  if (enrichment.purchaseAmount) {
    clienteData.montoPrimeraCompra = parseFloat(enrichment.purchaseAmount);
  }

  // Si ya existe en Twenty, actualizar
  if (existingId) {
    await twentyService.updateCliente(existingId, clienteData);
    return existingId;
  }

  // Buscar por establecimientoId
  let existing = await twentyService.findClienteByEstablecimientoId(establecimientoId);

  if (existing) {
    await twentyService.updateCliente(existing.id, clienteData);
    return existing.id;
  }

  // Crear nuevo
  const created = await twentyService.createCliente(clienteData);
  return created.id;
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
