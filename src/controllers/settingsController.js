const settingsService = require('../services/settingsService');
const logger = require('../config/logger');

// ========================================
// Configuraciones del Programa
// ========================================

/**
 * Obtener todas las configuraciones
 */
const getAllConfigs = async (req, res, next) => {
  try {
    const configs = await settingsService.getAllConfigs();

    res.json({
      success: true,
      data: configs,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener una configuración específica
 */
const getConfig = async (req, res, next) => {
  try {
    const { key } = req.params;
    const value = await settingsService.getConfig(key);

    if (value === null) {
      return res.status(404).json({
        success: false,
        error: `Configuración '${key}' no encontrada`,
      });
    }

    res.json({
      success: true,
      data: { key, value },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Actualizar una configuración
 */
const updateConfig = async (req, res, next) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;

    if (value === undefined) {
      return res.status(400).json({
        success: false,
        error: "Se requiere el campo 'value'",
      });
    }

    const config = await settingsService.setConfig(key, value, description);

    logger.info(`Config ${key} updated by admin ${req.user.email}`);

    res.json({
      success: true,
      data: config,
      message: `Configuración '${key}' actualizada correctamente`,
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// Plantillas de Email
// ========================================

/**
 * Listar todas las plantillas
 */
const listEmailTemplates = async (req, res, next) => {
  try {
    const templates = await settingsService.listEmailTemplates();

    res.json({
      success: true,
      data: templates,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener una plantilla por ID
 */
const getEmailTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const template = await settingsService.getEmailTemplate(id);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Plantilla no encontrada',
      });
    }

    res.json({
      success: true,
      data: template,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Crear una plantilla
 */
const createEmailTemplate = async (req, res, next) => {
  try {
    const { name, subject, htmlBody, textBody, variables } = req.body;

    if (!name || !subject || !htmlBody || !textBody) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren los campos: name, subject, htmlBody, textBody',
      });
    }

    const template = await settingsService.createEmailTemplate({
      name,
      subject,
      htmlBody,
      textBody,
      variables,
    });

    logger.info(`Email template '${name}' created by admin ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: template,
      message: 'Plantilla creada correctamente',
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'Ya existe una plantilla con ese nombre',
      });
    }
    next(error);
  }
};

/**
 * Actualizar una plantilla
 */
const updateEmailTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, subject, htmlBody, textBody, variables, isActive } = req.body;

    const template = await settingsService.updateEmailTemplate(id, {
      name,
      subject,
      htmlBody,
      textBody,
      variables,
      isActive,
    });

    logger.info(`Email template ${id} updated by admin ${req.user.email}`);

    res.json({
      success: true,
      data: template,
      message: 'Plantilla actualizada correctamente',
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'Plantilla no encontrada',
      });
    }
    next(error);
  }
};

/**
 * Eliminar una plantilla
 */
const deleteEmailTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;

    await settingsService.deleteEmailTemplate(id);

    logger.info(`Email template ${id} deleted by admin ${req.user.email}`);

    res.json({
      success: true,
      message: 'Plantilla eliminada correctamente',
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'Plantilla no encontrada',
      });
    }
    next(error);
  }
};

// ========================================
// API Keys
// ========================================

/**
 * Listar todas las API keys
 */
const listApiKeys = async (req, res, next) => {
  try {
    const apiKeys = await settingsService.listApiKeys();

    res.json({
      success: true,
      data: apiKeys,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Crear una nueva API key
 */
const createApiKey = async (req, res, next) => {
  try {
    const { name, description, expiresAt } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Se requiere el campo 'name'",
      });
    }

    const apiKey = await settingsService.createApiKey({
      name,
      description,
      expiresAt,
    });

    logger.info(`API key '${name}' created by admin ${req.user.email}`);

    res.status(201).json({
      success: true,
      data: apiKey,
      message: 'API key creada correctamente. Guarda la key, no se mostrará de nuevo.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Revocar una API key
 */
const revokeApiKey = async (req, res, next) => {
  try {
    const { id } = req.params;

    await settingsService.revokeApiKey(id);

    logger.info(`API key ${id} revoked by admin ${req.user.email}`);

    res.json({
      success: true,
      message: 'API key revocada correctamente',
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'API key no encontrada',
      });
    }
    next(error);
  }
};

/**
 * Eliminar permanentemente una API key
 */
const deleteApiKey = async (req, res, next) => {
  try {
    const { id } = req.params;

    await settingsService.deleteApiKey(id);

    logger.info(`API key ${id} deleted by admin ${req.user.email}`);

    res.json({
      success: true,
      message: 'API key eliminada correctamente',
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'API key no encontrada',
      });
    }
    next(error);
  }
};

// ========================================
// Exportar
// ========================================

// ========================================
// Endpoints Públicos
// ========================================

/**
 * Obtener información pública del programa (logo, nombre, etc.)
 * Disponible para cualquier usuario autenticado
 */
const getPublicProgramInfo = async (req, res, next) => {
  try {
    const programInfo = await settingsService.getConfig('program_info');

    // Valores por defecto si no hay configuración
    const defaultInfo = {
      name: 'EasyOrder Partners',
      logoUrl: '/EasyOrder.png',
      supportEmail: 'partners@easyorder.mx',
      referralBaseUrl: 'https://easyorder.mx/?ref=',
      termsUrl: 'https://easyorder.mx/terminos',
      privacyUrl: 'https://easyorder.mx/privacidad',
    };

    res.json({
      success: true,
      data: programInfo || defaultInfo,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  // Configuraciones
  getAllConfigs,
  getConfig,
  updateConfig,
  // Email Templates
  listEmailTemplates,
  getEmailTemplate,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  // API Keys
  listApiKeys,
  createApiKey,
  revokeApiKey,
  deleteApiKey,
  // Públicos
  getPublicProgramInfo,
};
