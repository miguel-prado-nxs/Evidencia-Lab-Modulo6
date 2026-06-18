/**
 * Admin Sales Controller
 * Controlador para endpoints de administrador de ventas
 */

const adminSalesService = require('../services/adminSalesService');
const logger = require('../config/logger');

/**
 * GET /api/v1/geo/admin/sales-users
 * Lista todos los agentes de ventas
 */
async function getSalesUsers(req, res, next) {
  try {
    const salesUsers = await adminSalesService.getSalesPartners();

    res.json({
      success: true,
      data: salesUsers,
      count: salesUsers.length,
    });
  } catch (error) {
    logger.error('Error en getSalesUsers:', error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/admin/all-prospects
 * Obtener todos los prospectos de todos los agentes de ventas
 */
async function getAllProspects(req, res, next) {
  try {
    const { salesPartnerId, status } = req.query;

    const prospects = await adminSalesService.getAllSalesProspects({
      salesPartnerId,
      status,
    });

    res.json({
      success: true,
      data: prospects,
      count: prospects.length,
    });
  } catch (error) {
    logger.error('Error en getAllProspects:', error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/admin/all-leads
 * Obtener todos los leads de todos los agentes de ventas
 */
async function getAllLeads(req, res, next) {
  try {
    const { salesPartnerId } = req.query;

    const leads = await adminSalesService.getAllSalesLeads({
      salesPartnerId,
    });

    res.json({
      success: true,
      data: leads,
      count: leads.length,
    });
  } catch (error) {
    logger.error('Error en getAllLeads:', error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/admin/all-clients
 * Obtener todos los clientes de todos los agentes de ventas
 */
async function getAllClients(req, res, next) {
  try {
    const { salesPartnerId } = req.query;

    const clients = await adminSalesService.getAllSalesClients({
      salesPartnerId,
    });

    res.json({
      success: true,
      data: clients,
      count: clients.length,
    });
  } catch (error) {
    logger.error('Error en getAllClients:', error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/admin/sales-stats
 * Obtener estadísticas agregadas de ventas
 */
async function getSalesStats(req, res, next) {
  try {
    const stats = await adminSalesService.getSalesStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Error en getSalesStats:', error);
    next(error);
  }
}

module.exports = {
  getSalesUsers,
  getAllProspects,
  getAllLeads,
  getAllClients,
  getSalesStats,
};
