/**
 * Ventas Enrichment Controller
 * Controladores específicos para el flujo de ventas de easyorder-leads
 * 
 * Endpoints exclusivos para la aplicación de ventas (easyorder-leads)
 * que no afectan el funcionamiento de partners-portal
 */

const ventasEnrichmentService = require("../services/ventasEnrichmentService");
const logger = require("../config/logger");

/**
 * POST /geo/ventas/contacts
 * Agregar un establecimiento a los contactos del usuario de ventas
 */
async function addToContacts(req, res) {
  try {
    const { establishmentId, notes } = req.body;
    const partnerId = req.salesPartnerId;

    if (!establishmentId) {
      return res.status(400).json({
        success: false,
        error: "establishmentId es requerido",
      });
    }

    if (!partnerId) {
      return res.status(401).json({
        success: false,
        error: "Partner de ventas no identificado",
      });
    }

    const result = await ventasEnrichmentService.addToContacts(
      establishmentId,
      partnerId,
      notes
    );

    res.status(result.isNew ? 201 : 200).json({
      success: true,
      data: result,
      message: result.isNew 
        ? "Establecimiento agregado a tus contactos" 
        : "Este establecimiento ya está en tus contactos",
    });
  } catch (error) {
    logger.error("[VentasController] Error en addToContacts:", error);
    res.status(error.message.includes("no encontrado") ? 404 : 500).json({
      success: false,
      error: error.message || "Error agregando contacto",
    });
  }
}

/**
 * POST /geo/ventas/contacts/:establishmentId/to-prospect
 * Convertir un contacto a prospecto agregando datos del tomador de decisiones
 */
async function convertContactToProspect(req, res) {
  try {
    const { establishmentId } = req.params;
    const contactData = req.body;
    const partnerId = req.salesPartnerId;

    if (!partnerId) {
      return res.status(401).json({
        success: false,
        error: "Partner de ventas no identificado",
      });
    }

    const result = await ventasEnrichmentService.convertContactToProspect(
      establishmentId,
      contactData,
      partnerId
    );

    res.json({
      success: true,
      data: result,
      message: "Contacto convertido a prospecto exitosamente",
    });
  } catch (error) {
    logger.error("[VentasController] Error en convertContactToProspect:", error);
    res.status(error.message.includes("no encontró") ? 404 : 400).json({
      success: false,
      error: error.message || "Error convirtiendo contacto a prospecto",
    });
  }
}

/**
 * GET /geo/ventas/contacts
 * Obtener todos los contactos del usuario de ventas (nivel CONTACT)
 */
async function getMyContacts(req, res) {
  try {
    const partnerId = req.salesPartnerId;

    if (!partnerId) {
      return res.status(401).json({
        success: false,
        error: "Partner de ventas no identificado",
      });
    }

    const contacts = await ventasEnrichmentService.getMyContacts(partnerId);

    res.json({
      success: true,
      data: contacts,
      count: contacts.length,
    });
  } catch (error) {
    logger.error("[VentasController] Error en getMyContacts:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Error obteniendo contactos",
    });
  }
}

/**
 * GET /geo/ventas/stats
 * Obtener estadísticas de ventas por nivel (incluyendo CONTACT)
 */
async function getVentasStats(req, res) {
  try {
    const partnerId = req.salesPartnerId;

    if (!partnerId) {
      return res.status(401).json({
        success: false,
        error: "Partner de ventas no identificado",
      });
    }

    const stats = await ventasEnrichmentService.getVentasStats(partnerId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("[VentasController] Error en getVentasStats:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Error obteniendo estadísticas",
    });
  }
}

/**
 * PATCH /geo/ventas/prospects/:establishmentId
 * Actualizar datos de un prospecto
 */
async function updateProspect(req, res) {
  try {
    const { establishmentId } = req.params;
    const data = req.body;
    const partnerId = req.salesPartnerId;

    if (!partnerId) {
      return res.status(401).json({
        success: false,
        error: "Partner de ventas no identificado",
      });
    }

    const result = await ventasEnrichmentService.updateProspect(
      establishmentId,
      data,
      partnerId
    );

    res.json({
      success: true,
      data: result,
      message: "Prospecto actualizado exitosamente",
    });
  } catch (error) {
    logger.error("[VentasController] Error en updateProspect:", error);
    res.status(error.message.includes("no encontró") ? 404 : 400).json({
      success: false,
      error: error.message || "Error actualizando prospecto",
    });
  }
}

/**
 * DELETE /geo/ventas/enrichments/:establishmentId
 * Eliminar un contacto/prospecto de la lista del usuario
 */
async function removeFromMyList(req, res) {
  try {
    const { establishmentId } = req.params;
    const partnerId = req.salesPartnerId;

    if (!partnerId) {
      return res.status(401).json({
        success: false,
        error: "Partner de ventas no identificado",
      });
    }

    await ventasEnrichmentService.removeFromMyList(establishmentId, partnerId);

    res.json({
      success: true,
      message: "Registro eliminado exitosamente",
    });
  } catch (error) {
    logger.error("[VentasController] Error en removeFromMyList:", error);
    res.status(error.message.includes("permiso") ? 403 : 400).json({
      success: false,
      error: error.message || "Error eliminando registro",
    });
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
