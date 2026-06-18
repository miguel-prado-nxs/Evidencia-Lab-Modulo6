const prisma = require('../config/database');
const crypto = require('crypto');
const logger = require('../config/logger');

// ========================================
// Claves de configuración del programa
// ========================================

const CONFIG_KEYS = {
  COMMISSION_RATES: 'commission_rates',
  TIER_BONUSES: 'tier_bonuses',
  TIER_REQUIREMENTS: 'tier_requirements',
  NOTIFICATION_SETTINGS: 'notification_settings',
  PROGRAM_INFO: 'program_info',
};

// ========================================
// Valores por defecto
// ========================================

const DEFAULT_CONFIG = {
  commission_rates: {
    AFFILIATE: 0.1,
    REFERRAL: 0.08,
    RESELLER: 0.15,
    SOLUTIONS: 0.12,
    TECHNOLOGY: 0.08,
  },
  tier_bonuses: {
    SILVER: 0.05,
    GOLD: 0.1,
    ELITE: 0.15,
  },
  tier_requirements: {
    SILVER: { deals: 5, revenue: 50000 },
    GOLD: { deals: 15, revenue: 150000 },
    ELITE: { deals: 30, revenue: 500000 },
  },
  notification_settings: {
    LEAD_NEW: { email: true, push: true },
    LEAD_STATUS_CHANGED: { email: true, push: true },
    DEAL_CLOSED: { email: true, push: true },
    COMMISSION_APPROVED: { email: true, push: true },
    COMMISSION_PAID: { email: true, push: true },
    PARTNER_APPROVED: { email: true, push: false },
    PARTNER_TIER_UPGRADE: { email: true, push: true },
    SYSTEM: { email: true, push: false },
  },
  program_info: {
    name: 'EasyOrder Partners',
    logoUrl: '/EasyOrder.png',
    supportEmail: 'partners@easyorder.mx',
    referralBaseUrl: 'https://easyorder.mx/?ref=',
    termsUrl: 'https://easyorder.mx/terminos',
    privacyUrl: 'https://easyorder.mx/privacidad',
  },
};

// ========================================
// Funciones de Configuración
// ========================================

/**
 * Obtener una configuración por clave
 */
const getConfig = async (key) => {
  try {
    const config = await prisma.programConfig.findUnique({
      where: { key },
    });

    if (config) {
      return config.value;
    }

    // Retornar valor por defecto si existe
    if (DEFAULT_CONFIG[key]) {
      return DEFAULT_CONFIG[key];
    }

    return null;
  } catch (error) {
    logger.error(`Error getting config ${key}:`, error);
    throw error;
  }
};

/**
 * Establecer una configuración
 */
const setConfig = async (key, value, description = null) => {
  try {
    const config = await prisma.programConfig.upsert({
      where: { key },
      update: {
        value,
        description: description || undefined,
      },
      create: {
        key,
        value,
        description,
      },
    });

    logger.info(`Config ${key} updated`);
    return config;
  } catch (error) {
    logger.error(`Error setting config ${key}:`, error);
    throw error;
  }
};

/**
 * Obtener todas las configuraciones
 */
const getAllConfigs = async () => {
  try {
    const configs = await prisma.programConfig.findMany();

    // Crear un mapa de configuraciones existentes
    const configMap = {};
    configs.forEach((c) => {
      configMap[c.key] = {
        id: c.id,
        key: c.key,
        value: c.value,
        description: c.description,
        updatedAt: c.updatedAt,
      };
    });

    // Agregar valores por defecto para las claves que no existen
    for (const [key, defaultValue] of Object.entries(DEFAULT_CONFIG)) {
      if (!configMap[key]) {
        configMap[key] = {
          id: null,
          key,
          value: defaultValue,
          description: null,
          updatedAt: null,
          isDefault: true,
        };
      }
    }

    return configMap;
  } catch (error) {
    logger.error('Error getting all configs:', error);
    throw error;
  }
};

/**
 * Inicializar configuraciones por defecto si no existen
 */
const initializeDefaultConfigs = async () => {
  try {
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      const existing = await prisma.programConfig.findUnique({
        where: { key },
      });

      if (!existing) {
        await prisma.programConfig.create({
          data: {
            key,
            value,
            description: `Configuración por defecto: ${key}`,
          },
        });
        logger.info(`Initialized default config: ${key}`);
      }
    }
  } catch (error) {
    logger.error('Error initializing default configs:', error);
    throw error;
  }
};

// ========================================
// Funciones de Email Templates
// ========================================

/**
 * Listar todas las plantillas de email
 */
const listEmailTemplates = async () => {
  return prisma.emailTemplate.findMany({
    orderBy: { name: 'asc' },
  });
};

/**
 * Obtener una plantilla por ID
 */
const getEmailTemplate = async (id) => {
  return prisma.emailTemplate.findUnique({
    where: { id },
  });
};

/**
 * Crear una plantilla de email
 */
const createEmailTemplate = async (data) => {
  const { name, subject, htmlBody, textBody, variables } = data;

  return prisma.emailTemplate.create({
    data: {
      name,
      subject,
      htmlBody,
      textBody,
      variables: variables || {},
      isActive: true,
    },
  });
};

/**
 * Actualizar una plantilla de email
 */
const updateEmailTemplate = async (id, data) => {
  const { name, subject, htmlBody, textBody, variables, isActive } = data;

  return prisma.emailTemplate.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(subject && { subject }),
      ...(htmlBody && { htmlBody }),
      ...(textBody && { textBody }),
      ...(variables && { variables }),
      ...(isActive !== undefined && { isActive }),
    },
  });
};

/**
 * Eliminar una plantilla de email
 */
const deleteEmailTemplate = async (id) => {
  return prisma.emailTemplate.delete({
    where: { id },
  });
};

// ========================================
// Funciones de API Keys
// ========================================

/**
 * Generar una API key segura
 */
const generateApiKey = () => {
  return `eo_${crypto.randomBytes(32).toString('hex')}`;
};

/**
 * Listar todas las API keys (sin mostrar la key completa)
 */
const listApiKeys = async () => {
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: 'desc' },
  });

  // Ocultar la key completa, mostrar solo los últimos 8 caracteres
  return keys.map((k) => ({
    ...k,
    key: `eo_****${k.key.slice(-8)}`,
  }));
};

/**
 * Crear una nueva API key
 */
const createApiKey = async (data) => {
  const { name, description, expiresAt } = data;
  const key = generateApiKey();

  const apiKey = await prisma.apiKey.create({
    data: {
      key,
      name,
      description,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      isActive: true,
    },
  });

  // Retornar con la key visible (solo esta vez)
  return {
    ...apiKey,
    keyVisible: key, // La key completa solo se muestra al crear
  };
};

/**
 * Revocar (eliminar) una API key
 */
const revokeApiKey = async (id) => {
  return prisma.apiKey.update({
    where: { id },
    data: { isActive: false },
  });
};

/**
 * Eliminar permanentemente una API key
 */
const deleteApiKey = async (id) => {
  return prisma.apiKey.delete({
    where: { id },
  });
};

/**
 * Validar una API key
 */
const validateApiKey = async (key) => {
  const apiKey = await prisma.apiKey.findUnique({
    where: { key },
  });

  if (!apiKey) return null;
  if (!apiKey.isActive) return null;
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

  // Actualizar último uso
  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return apiKey;
};

// ========================================
// Exportar
// ========================================

module.exports = {
  // Constantes
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  // Configuraciones
  getConfig,
  setConfig,
  getAllConfigs,
  initializeDefaultConfigs,
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
  validateApiKey,
};
