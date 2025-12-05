const partnerService = require("../services/partnerService");
const logger = require("../config/logger");

// Crear partner (admin)
const create = async (req, res, next) => {
  try {
    const { 
      email, 
      password, 
      name, 
      type, 
      companyName, 
      phone, 
      website, 
      country, 
      state, 
      city,
      status // opcional: ACTIVE para aprobar directamente
    } = req.body;

    // Validar campos requeridos
    if (!email || !password || !name || !type) {
      return res.status(400).json({
        success: false,
        error: "Campos requeridos: email, password, name, type",
      });
    }

    // Crear partner con opción de auto-aprobar
    const autoApprove = status === "ACTIVE";
    const { user, partner } = await partnerService.createPartner({
      email,
      password,
      name,
      type,
      companyName,
      phone,
      website,
      country,
      state,
      city,
    }, autoApprove);

    logger.info(`Partner creado por admin: ${email} (autoApprove: ${autoApprove})`);

    res.status(201).json({
      success: true,
      message: autoApprove 
        ? "Partner creado y activado exitosamente"
        : "Partner creado exitosamente (pendiente de aprobación)",
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        partner: {
          id: partner.id,
          code: partner.code,
          type: partner.type,
          tier: partner.tier,
          status: partner.status,
        },
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        error: "Ya existe un usuario con este email",
      });
    }
    next(error);
  }
};

// Listar partners (admin)
const list = async (req, res, next) => {
  try {
    const { type, tier, status, search, page, limit, sortBy, sortOrder } = req.query;

    const result = await partnerService.listPartners({
      type,
      tier,
      status,
      search,
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

// Obtener partner por ID
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const partner = await partnerService.getPartnerById(id);

    if (!partner) {
      return res.status(404).json({
        success: false,
        error: "Partner no encontrado",
      });
    }

    res.json({
      success: true,
      data: partner,
    });
  } catch (error) {
    next(error);
  }
};

// Actualizar partner
const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Verificar permisos (admin puede actualizar cualquiera, partner solo el suyo)
    if (req.user.role !== "ADMIN" && req.user.partner?.id !== id) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para actualizar este partner",
      });
    }

    const partner = await partnerService.updatePartner(id, updateData);

    res.json({
      success: true,
      data: partner,
    });
  } catch (error) {
    next(error);
  }
};

// Cambiar status del partner (admin)
const updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const partner = await partnerService.updatePartnerStatus(id, status);

    logger.info(`Partner ${id} status cambiado a ${status}`);

    res.json({
      success: true,
      data: partner,
    });
  } catch (error) {
    next(error);
  }
};

// Cambiar tier del partner (admin)
const updateTier = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tier } = req.body;

    const partner = await partnerService.updatePartnerTier(id, tier);

    logger.info(`Partner ${id} tier cambiado a ${tier}`);

    res.json({
      success: true,
      data: partner,
    });
  } catch (error) {
    next(error);
  }
};

// Obtener estadísticas del partner
const getStats = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verificar permisos
    if (req.user.role !== "ADMIN" && req.user.partner?.id !== id) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para ver estas estadísticas",
      });
    }

    const stats = await partnerService.getPartnerStats(id);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

// Validar código de partner (público)
const validateCode = async (req, res, next) => {
  try {
    const { code } = req.params;
    const partner = await partnerService.getPartnerByCode(code);

    if (!partner || partner.status !== "ACTIVE") {
      return res.status(404).json({
        success: false,
        error: "Código de partner no válido",
      });
    }

    res.json({
      success: true,
      data: {
        valid: true,
        partnerName: partner.companyName || partner.user.name,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  create,
  list,
  getById,
  update,
  updateStatus,
  updateTier,
  getStats,
  validateCode,
};

