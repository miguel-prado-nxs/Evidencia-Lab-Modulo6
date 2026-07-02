const dealService = require('../services/dealService');
const logger = require('../config/logger');

// Listar deals
const list = async (req, res, next) => {
  try {
    const { partnerId, status, dateFrom, dateTo, page, limit, sortBy, sortOrder } = req.query;

    // Si no es admin, filtrar solo por su partnerId
    const filterPartnerId = req.user.role === 'ADMIN' ? partnerId : req.user.partner?.id;

    const result = await dealService.listDeals({
      partnerId: filterPartnerId,
      status,
      dateFrom,
      dateTo,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      sortBy: sortBy || 'closedAt',
      sortOrder: sortOrder || 'desc',
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

// Obtener deal por ID
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deal = await dealService.getDealById(id);

    if (!deal) {
      return res.status(404).json({
        success: false,
        error: 'Deal no encontrado',
      });
    }

    // Verificar permisos
    if (req.user.role !== 'ADMIN' && req.user.partner?.id !== deal.partnerId) {
      return res.status(403).json({
        success: false,
        error: 'No tienes permisos para ver este deal',
      });
    }

    res.json({
      success: true,
      data: deal,
    });
  } catch (error) {
    next(error);
  }
};

// Crear deal (desde lead ganado) - solo admin
const create = async (req, res, next) => {
  try {
    const { leadId, customerId, planType, planPrice, setupFee } = req.body;

    const deal = await dealService.createDeal({
      leadId,
      customerId,
      planType,
      planPrice,
      setupFee,
    });

    logger.info(`Deal creado: ${deal.id} desde lead ${leadId}`);

    res.status(201).json({
      success: true,
      data: deal,
    });
  } catch (error) {
    if (
      error.message.includes('Lead no encontrado') ||
      error.message.includes('ya tiene un deal')
    ) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
};

// Actualizar status del deal - solo admin
const updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const deal = await dealService.updateDealStatus(id, status);

    logger.info(`Deal ${id} status cambiado a ${status}`);

    res.json({
      success: true,
      data: deal,
    });
  } catch (error) {
    if (error.message === 'Deal no encontrado') {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
};

module.exports = {
  list,
  getById,
  create,
  updateStatus,
};
