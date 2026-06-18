/**
 * Resources Controller
 * Controlador para la API de recursos/materiales de ventas
 */

const prisma = require('../config/database');
const storageService = require('../services/storageService');
const logger = require('../config/logger');

// Mapeo de tiers para filtrar
const TIER_ORDER = ['REGISTERED', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];

/**
 * GET /resources
 * Listar recursos disponibles
 */
async function list(req, res, next) {
  try {
    const { category, type, search, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Filtros base
    const where = { isActive: true };

    // Para partners, filtrar por tier y tipo
    if (req.user.role !== 'ADMIN' && req.user.partner) {
      const partnerTier = req.user.partner.tier;
      const partnerType = req.user.partner.type;

      // Filtrar por tier mínimo
      const allowedTiers = TIER_ORDER.slice(0, TIER_ORDER.indexOf(partnerTier) + 1);
      where.minTier = { in: allowedTiers };

      // Filtrar por tipo de partner (si el recurso tiene restricción)
      where.OR = [
        { partnerTypes: { isEmpty: true } }, // Sin restricción de tipo
        { partnerTypes: { has: partnerType } }, // Incluye el tipo del partner
      ];
    }

    if (category) where.category = category;
    if (type) where.type = type;
    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { tags: { hasSome: [search] } },
          ],
        },
      ];
    }

    const [resources, total] = await Promise.all([
      prisma.resource.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.resource.count({ where }),
    ]);

    res.json({
      success: true,
      data: resources,
      pagination: {
        page: parseInt(page),
        pageSize: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    logger.error('Error listing resources:', error);
    next(error);
  }
}

/**
 * GET /resources/:id
 * Obtener detalle de recurso
 */
async function getById(req, res, next) {
  try {
    const { id } = req.params;

    const resource = await prisma.resource.findUnique({
      where: { id },
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        error: 'Recurso no encontrado',
      });
    }

    // Verificar permisos si es partner
    if (req.user.role !== 'ADMIN' && req.user.partner) {
      const partnerTier = req.user.partner.tier;
      const partnerType = req.user.partner.type;
      const tierIndex = TIER_ORDER.indexOf(partnerTier);
      const minTierIndex = TIER_ORDER.indexOf(resource.minTier);

      if (tierIndex < minTierIndex) {
        return res.status(403).json({
          success: false,
          error: 'No tienes acceso a este recurso. Sube de tier para desbloquearlo.',
        });
      }

      if (resource.partnerTypes.length > 0 && !resource.partnerTypes.includes(partnerType)) {
        return res.status(403).json({
          success: false,
          error: 'Este recurso no está disponible para tu tipo de partner.',
        });
      }
    }

    // Incrementar contador de vistas
    await prisma.resource.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    res.json({
      success: true,
      data: resource,
    });
  } catch (error) {
    logger.error('Error getting resource:', error);
    next(error);
  }
}

/**
 * GET /resources/:id/download
 * Descargar archivo del recurso
 */
async function download(req, res, next) {
  try {
    const { id } = req.params;

    const resource = await prisma.resource.findUnique({
      where: { id },
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        error: 'Recurso no encontrado',
      });
    }

    // Verificar permisos
    if (req.user.role !== 'ADMIN' && req.user.partner) {
      const partnerTier = req.user.partner.tier;
      const tierIndex = TIER_ORDER.indexOf(partnerTier);
      const minTierIndex = TIER_ORDER.indexOf(resource.minTier);

      if (tierIndex < minTierIndex) {
        return res.status(403).json({
          success: false,
          error: 'No tienes acceso a este recurso.',
        });
      }
    }

    // Incrementar contador de descargas
    await prisma.resource.update({
      where: { id },
      data: { downloads: { increment: 1 } },
    });

    // Si tiene URL (S3 o externa)
    if (resource.url) {
      // Redirigir a la URL del archivo
      return res.redirect(resource.url);
    }

    // Si es archivo local (legacy)
    if (resource.storagePath) {
      const exists = await storageService.fileExists(resource.storagePath);
      if (!exists) {
        return res.status(404).json({
          success: false,
          error: 'Archivo no encontrado',
        });
      }

      const buffer = await storageService.readFile(resource.storagePath);
      const filename = resource.fileName || 'download';
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', resource.mimeType || 'application/octet-stream');
      return res.send(buffer);
    }

    return res.status(404).json({
      success: false,
      error: 'El recurso no tiene archivo asociado',
    });
  } catch (error) {
    logger.error('Error downloading resource:', error);
    next(error);
  }
}

/**
 * POST /resources (Admin only)
 * Crear nuevo recurso
 */
async function create(req, res, next) {
  try {
    const { name, description, category, type, url, minTier, partnerTypes, tags } = req.body;

    let fileData = {};

    // Si se subió un archivo
    if (req.file) {
      const processedFile = await storageService.processUploadedFile(req.file, 'resources');
      fileData = {
        fileName: processedFile.fileName,
        fileSize: processedFile.fileSize,
        mimeType: processedFile.mimeType,
        storagePath: processedFile.storagePath,
        url: processedFile.url, // URL de S3
        thumbnailUrl: processedFile.thumbnailUrl,
        type: type || processedFile.type,
      };
    }

    const resource = await prisma.resource.create({
      data: {
        name,
        description,
        category: category || 'OTHER',
        type: fileData.type || type || 'document',
        url: fileData.url || url, // Priorizar URL de S3
        minTier: minTier || 'REGISTERED',
        partnerTypes: partnerTypes
          ? Array.isArray(partnerTypes)
            ? partnerTypes
            : [partnerTypes]
          : [],
        tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim())) : [],
        fileName: fileData.fileName,
        fileSize: fileData.fileSize,
        mimeType: fileData.mimeType,
        storagePath: fileData.storagePath,
        thumbnailUrl: fileData.thumbnailUrl,
      },
    });

    logger.info(`Resource created: ${resource.id} by admin ${req.user.id}`);

    res.status(201).json({
      success: true,
      data: resource,
    });
  } catch (error) {
    // Limpiar archivo si hubo error
    if (req.file) {
      await storageService.deleteFile(req.file.path).catch(() => {});
    }
    logger.error('Error creating resource:', error);
    next(error);
  }
}

/**
 * PATCH /resources/:id (Admin only)
 * Actualizar recurso
 */
async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { name, description, category, type, url, minTier, partnerTypes, tags, isActive } =
      req.body;

    const existingResource = await prisma.resource.findUnique({
      where: { id },
    });

    if (!existingResource) {
      return res.status(404).json({
        success: false,
        error: 'Recurso no encontrado',
      });
    }

    let fileData = {};

    // Si se subió un nuevo archivo
    if (req.file) {
      const processedFile = await storageService.processUploadedFile(req.file, 'resources');
      fileData = {
        fileName: processedFile.fileName,
        fileSize: processedFile.fileSize,
        mimeType: processedFile.mimeType,
        storagePath: processedFile.storagePath,
        url: processedFile.url,
        thumbnailUrl: processedFile.thumbnailUrl,
        type: type || processedFile.type,
      };

      // Eliminar archivo anterior si existe
      if (existingResource.storagePath) {
        await storageService.deleteFile(existingResource.storagePath).catch(() => {});
      }
      if (
        existingResource.thumbnailUrl &&
        existingResource.thumbnailUrl.includes('storage.railway.app')
      ) {
        await storageService.deleteFile(existingResource.thumbnailUrl).catch(() => {});
      }
    }

    const resource = await prisma.resource.update({
      where: { id },
      data: {
        name,
        description,
        category,
        type: fileData.type || type,
        url: fileData.url || url,
        minTier,
        partnerTypes: partnerTypes
          ? Array.isArray(partnerTypes)
            ? partnerTypes
            : [partnerTypes]
          : undefined,
        tags: tags
          ? Array.isArray(tags)
            ? tags
            : tags.split(',').map((t) => t.trim())
          : undefined,
        isActive,
        fileName: fileData.fileName,
        fileSize: fileData.fileSize,
        mimeType: fileData.mimeType,
        storagePath: fileData.storagePath,
        thumbnailUrl: fileData.thumbnailUrl,
      },
    });

    logger.info(`Resource updated: ${id} by admin ${req.user.id}`);

    res.json({
      success: true,
      data: resource,
    });
  } catch (error) {
    if (req.file) {
      await storageService.deleteFile(req.file.path).catch(() => {});
    }
    logger.error('Error updating resource:', error);
    next(error);
  }
}

/**
 * DELETE /resources/:id (Admin only)
 * Eliminar recurso
 */
async function remove(req, res, next) {
  try {
    const { id } = req.params;

    const resource = await prisma.resource.findUnique({
      where: { id },
    });

    if (!resource) {
      return res.status(404).json({
        success: false,
        error: 'Recurso no encontrado',
      });
    }

    // Eliminar archivos asociados (S3 o local)
    if (resource.storagePath) {
      await storageService.deleteFile(resource.storagePath).catch(() => {});
    }
    if (resource.thumbnailUrl) {
      await storageService.deleteFile(resource.thumbnailUrl).catch(() => {});
    }

    await prisma.resource.delete({
      where: { id },
    });

    logger.info(`Resource deleted: ${id} by admin ${req.user.id}`);

    res.json({
      success: true,
      message: 'Recurso eliminado',
    });
  } catch (error) {
    logger.error('Error deleting resource:', error);
    next(error);
  }
}

/**
 * POST /resources/:id/track-download
 * Registrar descarga (para URLs externas)
 */
async function trackDownload(req, res, next) {
  try {
    const { id } = req.params;

    await prisma.resource.update({
      where: { id },
      data: { downloads: { increment: 1 } },
    });

    res.json({
      success: true,
      message: 'Descarga registrada',
    });
  } catch (error) {
    logger.error('Error tracking download:', error);
    next(error);
  }
}

/**
 * GET /resources/categories
 * Obtener categorías disponibles
 */
async function getCategories(req, res) {
  const categories = [
    { value: 'SALES_DECK', label: 'Presentaciones de Venta' },
    { value: 'ONE_PAGER', label: 'One Pagers' },
    { value: 'EMAIL_TEMPLATE', label: 'Plantillas de Email' },
    { value: 'SOCIAL_MEDIA', label: 'Redes Sociales' },
    { value: 'VIDEO', label: 'Videos' },
    { value: 'CASE_STUDY', label: 'Casos de Éxito' },
    { value: 'PRICE_LIST', label: 'Listas de Precios' },
    { value: 'BRAND_ASSETS', label: 'Recursos de Marca' },
    { value: 'CONTRACT_TEMPLATE', label: 'Plantillas de Contrato' },
    { value: 'OTHER', label: 'Otros' },
  ];

  res.json({
    success: true,
    data: categories,
  });
}

module.exports = {
  list,
  getById,
  download,
  create,
  update,
  remove,
  trackDownload,
  getCategories,
};
