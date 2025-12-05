/**
 * Export Controller
 * Controlador para la API de exportación de datos
 */

const exportService = require("../services/exportService");
const logger = require("../config/logger");

/**
 * GET /export/leads
 * Exportar leads
 */
async function exportLeads(req, res, next) {
  try {
    const { format = "csv", partnerId, status, dateFrom, dateTo } = req.query;

    // Si no es admin, forzar su partnerId
    const filterPartnerId =
      req.user.role === "ADMIN" ? partnerId : req.user.partner?.id;

    if (!filterPartnerId && req.user.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const result = await exportService.exportLeads(
      {
        partnerId: filterPartnerId,
        status,
        dateFrom,
        dateTo,
      },
      format
    );

    res.setHeader("Content-Type", result.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );
    res.send(result.data);

    logger.info(
      `Leads exported: ${format} by user ${req.user.id} (partner: ${filterPartnerId})`
    );
  } catch (error) {
    logger.error("Error exporting leads:", error);
    next(error);
  }
}

/**
 * GET /export/deals
 * Exportar deals
 */
async function exportDeals(req, res, next) {
  try {
    const { format = "csv", partnerId, status, dateFrom, dateTo } = req.query;

    // Si no es admin, forzar su partnerId
    const filterPartnerId =
      req.user.role === "ADMIN" ? partnerId : req.user.partner?.id;

    if (!filterPartnerId && req.user.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const result = await exportService.exportDeals(
      {
        partnerId: filterPartnerId,
        status,
        dateFrom,
        dateTo,
      },
      format
    );

    res.setHeader("Content-Type", result.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );
    res.send(result.data);

    logger.info(`Deals exported: ${format} by user ${req.user.id}`);
  } catch (error) {
    logger.error("Error exporting deals:", error);
    next(error);
  }
}

/**
 * GET /export/commissions
 * Exportar comisiones
 */
async function exportCommissions(req, res, next) {
  try {
    const { format = "csv", partnerId, status, type, dateFrom, dateTo } =
      req.query;

    // Si no es admin, forzar su partnerId
    const filterPartnerId =
      req.user.role === "ADMIN" ? partnerId : req.user.partner?.id;

    if (!filterPartnerId && req.user.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const result = await exportService.exportCommissions(
      {
        partnerId: filterPartnerId,
        status,
        type,
        dateFrom,
        dateTo,
      },
      format
    );

    res.setHeader("Content-Type", result.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );
    res.send(result.data);

    logger.info(`Commissions exported: ${format} by user ${req.user.id}`);
  } catch (error) {
    logger.error("Error exporting commissions:", error);
    next(error);
  }
}

/**
 * GET /export/partners (Admin only)
 * Exportar partners
 */
async function exportPartners(req, res, next) {
  try {
    const { format = "csv", type, tier, status, dateFrom, dateTo } = req.query;

    const result = await exportService.exportPartners(
      {
        type,
        tier,
        status,
        dateFrom,
        dateTo,
      },
      format
    );

    res.setHeader("Content-Type", result.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );
    res.send(result.data);

    logger.info(`Partners exported: ${format} by admin ${req.user.id}`);
  } catch (error) {
    logger.error("Error exporting partners:", error);
    next(error);
  }
}

/**
 * GET /export/report/:partnerId (Admin or owner)
 * Generar reporte completo de partner en PDF
 */
async function generatePartnerReport(req, res, next) {
  try {
    const { partnerId } = req.params;

    // Verificar permisos
    if (req.user.role !== "ADMIN" && req.user.partner?.id !== partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para ver este reporte",
      });
    }

    const pdfBuffer = await exportService.generatePartnerReport(partnerId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="partner_report_${partnerId}.pdf"`
    );
    res.send(pdfBuffer);

    logger.info(`Partner report generated: ${partnerId} by user ${req.user.id}`);
  } catch (error) {
    if (error.message === "Partner no encontrado") {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }
    logger.error("Error generating partner report:", error);
    next(error);
  }
}

module.exports = {
  exportLeads,
  exportDeals,
  exportCommissions,
  exportPartners,
  generatePartnerReport,
};

