/**
 * Ventas Enrichment Service
 * Servicios específicos para el flujo de ventas de easyorder-leads
 * 
 * FLUJO DE VENTAS:
 * 1. Usuario ve establecimiento en mapa → puede "Agregar a Contactos" o "Enriquecer manualmente"
 * 2. Al agregarlo a contactos → se crea en nivel CONTACT
 * 3. Desde "Mis Negocios" puede ver contactos y:
 *    - Usar "Enriquecer automático" (llamada)
 *    - "Convertir a Prospecto" (agregar datos del tomador de decisiones)
 * 4. Desde Prospecto puede actualizar datos y eventualmente convertir a Lead/Client
 * 
 * NOTA: Estos métodos son exclusivos para ventas, NO modifican enrichmentService.js
 */

const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");
const { enqueueSync } = require("./twenty/twentySyncService");

/**
 * Agregar un establecimiento a contactos del usuario de ventas
 * Crea un registro de enriquecimiento con nivel CONTACT
 * @param {string} establishmentId - ID del establecimiento en Mapa DB
 * @param {string} partnerId - ID del partner de ventas (VENTAS-{userId})
 * @param {string} notes - Notas opcionales
 * @returns {Object} - Registro de enriquecimiento creado
 */
async function addToContacts(establishmentId, partnerId, notes = null) {
  try {
    // 1. Validar que el establecimiento existe en Mapa DB
    const establishment = await prismaGeo.establishment.findUnique({
      where: { id: establishmentId },
      select: {
        id: true,
        clee: true, // IMPORTANTE: clave DENUE
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
      throw new Error("Establecimiento no encontrado en la base de datos");
    }

    // Usar clee (clave DENUE) como establishmentId, NO el UUID
    const clee = establishment.clee;
    if (!clee) {
      throw new Error(`Establishment ${establishmentId} no tiene clee (clave DENUE)`);
    }

    // 2. Verificar si ya existe un enriquecimiento (buscar por clee)
    const existing = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId: clee },
    });

    if (existing) {
      // Ya existe, retornar el existente con los datos del establecimiento
      return {
        ...existing,
        establishment,
        isNew: false,
      };
    }

    // 3. Crear nuevo registro de enriquecimiento con nivel CONTACT
    const enrichment = await prisma.establishmentEnrichment.create({
      data: {
        establishmentId: clee, // Usar clee, no UUID
        level: "CONTACT",
        enrichedBy: partnerId,
        enrichedAt: new Date(),
        lastUpdatedBy: partnerId,
        // Datos del establecimiento para Orchestrator (evita query a BD 801k)
        establishmentData: {
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
      },
    });

    logger.info(`[VentasEnrichment] Contacto agregado: ${establishment.name} por partner ${partnerId}`);

    // Encolar sincronizacion con Twenty CRM (non-blocking)
    // IMPORTANTE: Usar clee, no el UUID
    enqueueSync({
      establishmentId: clee,
      partnerId,
      reason: "ADD_TO_CONTACTS",
    }).catch((err) => {
      logger.warn("[VentasEnrichment] Error encolando sync (no critico)", { error: err.message });
    });

    return {
      ...enrichment,
      establishment,
      isNew: true,
    };
  } catch (error) {
    logger.error("[VentasEnrichment] Error agregando contacto:", error);
    throw error;
  }
}

/**
 * Convertir un contacto a prospecto
 * Actualiza el nivel de CONTACT a PROSPECT agregando datos del tomador de decisiones
 * Y crea un registro en la tabla lead_prospects para rastreo
 * @param {string} establishmentId - ID del establecimiento
 * @param {Object} contactData - Datos del tomador de decisiones
 * @param {string} partnerId - ID del partner de ventas
 * @returns {Object} - Registro actualizado
 */
async function convertContactToProspect(establishmentId, contactData, partnerId) {
  try {
    // 1. Obtener el establishment usando clee (establishmentId ahora es clee)
    const establishment = await prismaGeo.establishment.findFirst({
      where: { clee: establishmentId },
      select: {
        id: true,
        clee: true,
        name: true,
        phone: true,
        email: true,
        website: true,
        activityName: true,
        municipalityName: true,
        stateName: true,
      },
    });

    if (!establishment || !establishment.clee) {
      throw new Error("Establecimiento no encontrado o sin clave DENUE");
    }

    const clee = establishment.clee;

    // 2. Verificar que existe el enriquecimiento (buscar por clee)
    const existing = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId: clee },
    });

    if (!existing) {
      throw new Error("No se encontró el contacto. Primero agrégalo a tus contactos.");
    }

    // 3. Validar que tiene datos mínimos requeridos
    if (!contactData.decisionMakerName) {
      throw new Error("El nombre del tomador de decisiones es requerido");
    }

    if (!contactData.decisionMakerPhone && !contactData.decisionMakerWhatsApp) {
      throw new Error("Se requiere al menos un teléfono o WhatsApp");
    }

    // 4. Actualizar a nivel PROSPECT en establishmentEnrichment
    const enrichment = await prisma.establishmentEnrichment.update({
      where: { establishmentId: clee },
      data: {
        decisionMakerName: contactData.decisionMakerName,
        decisionMakerPosition: contactData.decisionMakerPosition || null,
        decisionMakerPhone: contactData.decisionMakerPhone || null,
        decisionMakerWhatsApp: contactData.decisionMakerWhatsApp || null,
        decisionMakerEmail: contactData.decisionMakerEmail || null,
        level: "PROSPECT",
        lastUpdatedBy: partnerId,
      },
    });

    // 4. Crear o actualizar registro en leadProspect para rastreo
    // NOTA: leadProspect usa el clee (igual que establishment_enrichments)
    let prospect = await prisma.leadProspect.findFirst({
      where: { establishmentId: clee },
    });

    if (prospect) {
      // Actualizar si ya existe
      prospect = await prisma.leadProspect.update({
        where: { id: prospect.id },
        data: {
          partnerId,
          status: "ASSIGNED",
          assignedAt: new Date(),
          notes: `Actualizado a Prospecto el ${new Date().toLocaleDateString('es-MX')}. Partner: ${partnerId}`,
        },
      });
    } else {
      // Crear si no existe
      prospect = await prisma.leadProspect.create({
        data: {
          establishmentId: clee,
          partnerId,
          status: "ASSIGNED",
          assignedAt: new Date(),
          notes: `Creado como Prospecto el ${new Date().toLocaleDateString('es-MX')}. Tomador de decisiones: ${contactData.decisionMakerName}`,
        },
      });
    }

    logger.info(`[VentasEnrichment] Contacto convertido a prospecto: ${establishment.name} por partner ${partnerId}`);

    // Encolar sincronizacion con Twenty CRM (non-blocking)
    // IMPORTANTE: Usar clee, no el UUID
    enqueueSync({
      establishmentId: clee,
      partnerId,
      reason: "CONTACT_TO_PROSPECT",
    }).catch((err) => {
      logger.warn("[VentasEnrichment] Error encolando sync (no critico)", { error: err.message });
    });

    return {
      ...enrichment,
      establishment,
      prospect,
    };
  } catch (error) {
    logger.error("[VentasEnrichment] Error convirtiendo contacto a prospecto:", error);
    throw error;
  }
}

/**
 * Obtener todos los contactos (nivel CONTACT) del usuario de ventas
 * @param {string} partnerId - ID del partner de ventas
 * @returns {Array} - Lista de contactos con datos del establecimiento
 */
async function getMyContacts(partnerId) {
  try {
    // 1. Obtener enriquecimientos de nivel CONTACT del partner
    const enrichments = await prisma.establishmentEnrichment.findMany({
      where: {
        enrichedBy: partnerId,
        level: "CONTACT",
      },
      orderBy: { createdAt: "desc" },
    });

    if (enrichments.length === 0) {
      return [];
    }

    // 2. Obtener IDs de establecimientos (ahora son clees, no UUIDs)
    const establishmentIds = enrichments.map((e) => e.establishmentId);

    // 3. Obtener datos de establecimientos de Mapa DB (buscar por clee)
    const establishments = await prismaGeo.establishment.findMany({
      where: { clee: { in: establishmentIds } },
      select: {
        id: true,
        clee: true,
        name: true,
        phone: true,
        email: true,
        website: true,
        activityName: true,
        municipalityName: true,
        stateName: true,
        latitude: true,
        longitude: true,
      },
    });

    // 4. Crear mapa para lookup rapido (usar clee como key)
    const establishmentMap = establishments.reduce((acc, e) => {
      acc[e.clee] = e;
      return acc;
    }, {});

    // 5. Combinar datos
    return enrichments.map((enrichment) => ({
      ...enrichment,
      establishment: establishmentMap[enrichment.establishmentId] || null,
    }));
  } catch (error) {
    logger.error("[VentasEnrichment] Error obteniendo contactos:", error);
    throw error;
  }
}

/**
 * Obtener estadísticas de ventas por nivel (incluyendo CONTACT)
 * @param {string} partnerId - ID del partner de ventas
 * @returns {Object} - Estadísticas por nivel
 */
async function getVentasStats(partnerId) {
  try {
    const stats = await prisma.establishmentEnrichment.groupBy({
      by: ["level"],
      where: { enrichedBy: partnerId },
      _count: { id: true },
    });

    const result = {
      CONTACT: 0,
      PROSPECT: 0,
      LEAD: 0,
      CLIENT: 0,
      total: 0,
    };

    stats.forEach((stat) => {
      if (result.hasOwnProperty(stat.level)) {
        result[stat.level] = stat._count.id;
        result.total += stat._count.id;
      }
    });

    return result;
  } catch (error) {
    logger.error("[VentasEnrichment] Error obteniendo estadísticas:", error);
    throw error;
  }
}

/**
 * Actualizar datos de un prospecto (nivel PROSPECT)
 * @param {string} establishmentId - ID del establecimiento
 * @param {Object} data - Datos a actualizar
 * @param {string} partnerId - ID del partner de ventas
 * @returns {Object} - Registro actualizado
 */
async function updateProspect(establishmentId, data, partnerId) {
  try {
    // Obtener establishment para convertir UUID a clee
    const establishment = await prismaGeo.establishment.findUnique({
      where: { id: establishmentId },
      select: {
        id: true,
        clee: true,
        name: true,
        phone: true,
        email: true,
        website: true,
        activityName: true,
        municipalityName: true,
        stateName: true,
      },
    });

    if (!establishment || !establishment.clee) {
      throw new Error("Establecimiento no encontrado o sin clave DENUE");
    }

    const clee = establishment.clee;

    const existing = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId: clee },
    });

    if (!existing) {
      throw new Error("No se encontro el prospecto");
    }

    // Solo permitir actualizar si es PROSPECT o mayor
    if (existing.level !== "PROSPECT" && existing.level !== "LEAD" && existing.level !== "CLIENT") {
      throw new Error("El establecimiento debe ser al menos un prospecto para actualizar");
    }

    const enrichment = await prisma.establishmentEnrichment.update({
      where: { establishmentId: clee },
      data: {
        decisionMakerName: data.decisionMakerName !== undefined ? data.decisionMakerName : existing.decisionMakerName,
        decisionMakerPosition: data.decisionMakerPosition !== undefined ? data.decisionMakerPosition : existing.decisionMakerPosition,
        decisionMakerPhone: data.decisionMakerPhone !== undefined ? data.decisionMakerPhone : existing.decisionMakerPhone,
        decisionMakerWhatsApp: data.decisionMakerWhatsApp !== undefined ? data.decisionMakerWhatsApp : existing.decisionMakerWhatsApp,
        decisionMakerEmail: data.decisionMakerEmail !== undefined ? data.decisionMakerEmail : existing.decisionMakerEmail,
        lastUpdatedBy: partnerId,
      },
    });

    // Encolar sincronizacion con Twenty CRM (non-blocking)
    enqueueSync({
      establishmentId: clee,
      partnerId,
      reason: "UPDATE_PROSPECT",
    }).catch((err) => {
      logger.warn("[VentasEnrichment] Error encolando sync (no critico)", { error: err.message });
    });

    return {
      ...enrichment,
      establishment,
    };
  } catch (error) {
    logger.error("[VentasEnrichment] Error actualizando prospecto:", error);
    throw error;
  }
}

/**
 * Eliminar un contacto/prospecto de la lista del usuario
 * @param {string} establishmentId - ID del establecimiento
 * @param {string} partnerId - ID del partner de ventas
 */
async function removeFromMyList(establishmentId, partnerId) {
  try {
    // Obtener establishment para convertir UUID a clee
    const establishment = await prismaGeo.establishment.findUnique({
      where: { id: establishmentId },
      select: { clee: true },
    });

    if (!establishment || !establishment.clee) {
      throw new Error("Establecimiento no encontrado o sin clave DENUE");
    }

    const clee = establishment.clee;

    const existing = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId: clee },
    });

    if (!existing) {
      throw new Error("No se encontro el registro");
    }

    // Verificar que pertenece al partner
    if (existing.enrichedBy !== partnerId) {
      throw new Error("No tienes permiso para eliminar este registro");
    }

    await prisma.establishmentEnrichment.delete({
      where: { establishmentId: clee },
    });

    logger.info(`[VentasEnrichment] Registro eliminado: ${clee} por partner ${partnerId}`);

    return { success: true };
  } catch (error) {
    logger.error("[VentasEnrichment] Error eliminando registro:", error);
    throw error;
  }
}

module.exports = {
  addToContacts,
  convertContactToProspect,
  getMyContacts,
  getVentasStats,
  updateProspect,
  removeFromMyList,
};
