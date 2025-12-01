const commissionService = require("../services/commissionService");
const logger = require("../config/logger");

// Listar comisiones
const list = async (req, res, next) => {
  try {
    const { partnerId, status, type, dateFrom, dateTo, page, limit, sortBy, sortOrder } = req.query;

    // Si no es admin, filtrar solo por su partnerId
    const filterPartnerId = req.user.role === "ADMIN" 
      ? partnerId 
      : req.user.partner?.id;

    const result = await commissionService.listCommissions({
      partnerId: filterPartnerId,
      status,
      type,
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

// Obtener comisiones pendientes agrupadas por partner (admin)
const getPending = async (req, res, next) => {
  try {
    const pending = await commissionService.getPendingCommissions();

    res.json({
      success: true,
      data: pending,
    });
  } catch (error) {
    next(error);
  }
};

// Aprobar comisiones (admin)
const approve = async (req, res, next) => {
  try {
    const { commissionIds } = req.body;

    if (!commissionIds || !Array.isArray(commissionIds) || commissionIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Se requiere un array de IDs de comisiones",
      });
    }

    const result = await commissionService.approveCommissions(commissionIds);

    logger.info(`${result.count} comisiones aprobadas`);

    res.json({
      success: true,
      message: `${result.count} comisiones aprobadas`,
    });
  } catch (error) {
    next(error);
  }
};

// Marcar comisiones como pagadas (admin)
const markPaid = async (req, res, next) => {
  try {
    const { commissionIds, paymentRef } = req.body;

    if (!commissionIds || !Array.isArray(commissionIds) || commissionIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Se requiere un array de IDs de comisiones",
      });
    }

    const result = await commissionService.markCommissionsAsPaid(commissionIds, paymentRef);

    logger.info(`${result.count} comisiones marcadas como pagadas. Ref: ${paymentRef || "N/A"}`);

    res.json({
      success: true,
      message: `${result.count} comisiones marcadas como pagadas`,
    });
  } catch (error) {
    next(error);
  }
};

// Obtener resumen de comisiones del partner
const getSummary = async (req, res, next) => {
  try {
    const partnerId = req.user.role === "ADMIN" 
      ? req.query.partnerId 
      : req.user.partner?.id;

    if (!partnerId) {
      return res.status(400).json({
        success: false,
        error: "Partner ID requerido",
      });
    }

    const summary = await commissionService.getCommissionSummary(partnerId);

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
};

// Exportar comisiones a CSV (admin)
const exportCommissions = async (req, res, next) => {
  try {
    const { partnerId, status, dateFrom, dateTo } = req.query;

    const commissions = await commissionService.exportCommissions({
      partnerId,
      status,
      dateFrom,
      dateTo,
    });

    // Generar CSV
    const headers = [
      "ID",
      "Partner Code",
      "Partner Name",
      "Partner Email",
      "Business Name",
      "Plan Type",
      "Type",
      "Amount",
      "Currency",
      "Status",
      "Created At",
      "Paid At",
      "Payment Ref",
    ];

    const rows = commissions.map((c) => [
      c.id,
      c.partner.code,
      c.partner.user.name,
      c.partner.user.email,
      c.deal.businessName,
      c.deal.planType,
      c.type,
      c.amount,
      c.currency,
      c.status,
      c.createdAt.toISOString(),
      c.paidAt ? c.paidAt.toISOString() : "",
      c.paymentRef || "",
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=commissions-${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  list,
  getPending,
  approve,
  markPaid,
  getSummary,
  exportCommissions,
};

