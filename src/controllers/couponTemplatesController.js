const fs = require("fs");
const prisma = require("../config/database");
const logger = require("../config/logger");
const cloudflareImagesService = require("../services/cloudflareImagesService");

const URL_MICROSTRIPE = process.env.MICROSTRIPE || "http://localhost:3002/api/stripe";

const normalizeStripeProductIds = (value) => {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" && item.trim().length > 0);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return [value];
  }

  return [];
};

const list = async (req, res, next) => {
  try {
    const { active, scenario } = req.query;

    const where = {};
    if (active !== undefined) {
      where.active = active === 'true';
    }
    if (scenario) {
      where.scenarios = {
        has: scenario
      };
    }

    const templates = await prisma.couponTemplate.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    next(error);
  }
};

const getByType = async (req, res, next) => {
  try {
    const { type } = req.params;

    const template = await prisma.couponTemplate.findUnique({
      where: { couponType: type }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: "Template not found"
      });
    }

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {
  try {
    const {
      couponType,
      name,
      description,
      scenarios,
      percentOff,
      durationMonths,
      trialDays,
      messageTemplate,
      mediaUrl,
      maxPerUser,
      expiresHours,
      validFrom,
      validUntil,
      validDays,
      validFor,
      priority,
      stripeProductIds,
      stripe_product_id
    } = req.body;
    const normalizedStripeProductIds = normalizeStripeProductIds(stripeProductIds ?? stripe_product_id);

    try {
      const couponCreateStripe = await fetch(`${URL_MICROSTRIPE}/promotion-codes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId: "admin_easyorder",
          productIds: normalizedStripeProductIds,
          percentOff,
          name: name,
          codes: [couponType],
          validUntil: validUntil,
          maxPerUser: maxPerUser,
          validDays: validDays
        })
      });

      const couponData = await couponCreateStripe.json();

      // Validar respuesta de Stripe
      if (!couponData.success || !couponData.coupon) {
        logger.error(`Stripe coupon creation failed: ${couponData.error || "Unknown error"}`, {
          couponType,
          response: couponData
        });
        return res.status(400).json({
          success: false,
          error: couponData.error || "Failed to create coupon in Stripe"
        });
      }

      const stripeCouponId = couponData.coupon?.id;

      const template = await prisma.couponTemplate.create({
        data: {
          couponType,
          name,
          description,
          scenarios: scenarios || [],
          percentOff,
          durationMonths,
          trialDays,
          messageTemplate,
          mediaUrl,
          maxPerUser: maxPerUser || 1,
          expiresHours: expiresHours || 48,
          validFrom: validFrom ? new Date(validFrom) : undefined,
          validUntil: validUntil ? new Date(validUntil) : undefined,
          validDays: validDays || [],
          validFor: validFor || [],
          priority: priority || 0,
          stripe_product_id: normalizedStripeProductIds,
          stripe_coupon_id: stripeCouponId || null
        }
      });

      logger.info(`Coupon template created: ${template.couponType}`, {
        templateId: template.id
      });

      res.status(201).json({
        success: true,
        data: template
      });
    } catch (stripeError) {
      logger.error(`Error creating coupon in Stripe: ${stripeError.message}`, {
        couponType,
        error: stripeError
      });
      return res.status(500).json({
        success: false,
        error: `Stripe service error: ${stripeError.message}`
      });
    }
  } catch (error) {
    next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const { type } = req.params;
    const {
      name,
      description,
      scenarios,
      percentOff,
      durationMonths,
      trialDays,
      messageTemplate,
      mediaUrl,
      maxPerUser,
      expiresHours,
      validFrom,
      validUntil,
      validDays,
      validFor,
      active,
      priority,
      stripeProductIds,
      stripe_product_id
    } = req.body;
    const normalizedStripeProductIds = normalizeStripeProductIds(stripeProductIds ?? stripe_product_id);

    // Obtener el template actual para ver qué cambió
    const currentTemplate = await prisma.couponTemplate.findUnique({
      where: { couponType: type }
    });

    if (!currentTemplate) {
      return res.status(404).json({
        success: false,
        error: "Template not found"
      });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (scenarios !== undefined) updateData.scenarios = scenarios;
    if (percentOff !== undefined) updateData.percentOff = percentOff;
    if (durationMonths !== undefined) updateData.durationMonths = durationMonths;
    if (trialDays !== undefined) updateData.trialDays = trialDays;
    if (messageTemplate !== undefined) updateData.messageTemplate = messageTemplate;
    if (mediaUrl !== undefined) updateData.mediaUrl = mediaUrl;
    if (maxPerUser !== undefined) updateData.maxPerUser = maxPerUser;
    if (expiresHours !== undefined) updateData.expiresHours = expiresHours;
    if (validFrom !== undefined) updateData.validFrom = new Date(validFrom);
    if (validUntil !== undefined) updateData.validUntil = new Date(validUntil);
    if (validDays !== undefined) updateData.validDays = validDays;
    if (validFor !== undefined) updateData.validFor = validFor;
    if (active !== undefined) updateData.active = active;
    if (priority !== undefined) updateData.priority = priority;
    if (stripeProductIds !== undefined || stripe_product_id !== undefined) updateData.stripe_product_id = normalizedStripeProductIds;

    // =========================================
    // SINCRONIZAR CAMBIOS CON STRIPE
    // =========================================
    if (currentTemplate.stripe_coupon_id && (name !== undefined || percentOff !== undefined || validUntil !== undefined || maxPerUser !== undefined || validDays !== undefined || stripeProductIds !== undefined || stripe_product_id !== undefined)) {
      try {
        const stripeResponse = await fetch(`${URL_MICROSTRIPE}/promotion-codes/${currentTemplate.stripe_coupon_id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            couponId: currentTemplate.stripe_coupon_id,
            name: name || currentTemplate.name,
            percentOff: percentOff !== undefined ? percentOff : currentTemplate.percentOff,
            productIds: normalizedStripeProductIds.length > 0 ? normalizedStripeProductIds : currentTemplate.stripe_product_id,
            validUntil: validUntil || currentTemplate.validUntil,
            maxPerUser: maxPerUser !== undefined ? maxPerUser : currentTemplate.maxPerUser,
            validDays: validDays || currentTemplate.validDays,
          })
        });

        const stripeData = await stripeResponse.json();

        if (stripeData.success) {
          // El cupón fue eliminado y recreado, actualizar el ID
          if (stripeData.new_coupon_id) {
            console.log(`♻️  Cupón sincronizado: ${currentTemplate.stripe_coupon_id} → ${stripeData.new_coupon_id}`);
            updateData.stripe_coupon_id = stripeData.new_coupon_id;
          }
          if (stripeData.coupon?.id) {
            updateData.stripe_coupon_id = stripeData.coupon.id;
          }
        } else {
          console.warn(`⚠️  Error al sincronizar con Stripe:`, stripeData.error);
          // Continuamos sin fallar, ya que la actualización local sigue siendo válida
        }
      } catch (stripeError) {
        console.error(`⚠️  Error conectando con Stripe:`, stripeError.message);
        // Continuamos sin fallar, ya que la actualización local sigue siendo válida
      }
    }

    const template = await prisma.couponTemplate.update({
      where: { couponType: type },
      data: updateData
    });

    logger.info(`Coupon template updated: ${template.couponType}`, {
      templateId: template.id,
      stripeSync: currentTemplate.stripe_coupon_id ? "yes" : "no"
    });

    res.json({
      success: true,
      data: template,
      stripe_synced: !!currentTemplate.stripe_coupon_id
    });
  } catch (error) {
    next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    const { type } = req.params;

    await prisma.couponTemplate.delete({
      where: { couponType: type }
    });

    logger.info(`Coupon template deleted: ${type}`);

    res.json({
      success: true,
      message: "Template deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Recibe un archivo de imagen (multipart via multer), lo sube a Cloudflare Images
 * y retorna la URL pública. El frontend la guarda en formData.mediaUrl.
 */
const uploadImage = async (req, res, next) => {
  const tempPath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No se recibió ningún archivo." });
    }

    const buffer = fs.readFileSync(tempPath);
    const { imageId, url } = await cloudflareImagesService.uploadImage(
      buffer,
      req.file.originalname,
      req.file.mimetype
    );

    res.json({ success: true, data: { url, imageId } });
  } catch (error) {
    // Error de validación (tipo/tamaño) o de API: responder 400, no propagar al errorHandler
    if (
      error.message.includes("Tipo de archivo") ||
      error.message.includes("excede el máximo") ||
      error.message.includes("Cloudflare Images no está configurado")
    ) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  } finally {
    // Limpiar archivo temporal sin importar el resultado
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch (_) { }
    }
  }
};

const getProductsFromStripe = async (req, res, next) => {
  try {
    const response = await fetch(`${URL_MICROSTRIPE}/products`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `Stripe service returned ${response.status}`,
        details: await response.text()
      });
    }

    const result = await response.json();

    return res.status(200).json({
      success: true,
      data: result.data || result
    });
  }
  catch (error) {
    console.error("Error fetching products from Stripe:", error);
    next(error);
  }
};

const syncWithStripe = async (req, res, next) => {
  try {
    const {
      couponId,
      couponType,
      customerId = "admin_easyorder",
      productIds,
      percentOff,
      amountOff,
      currency = "mxn",
      duration = "once",
      name,
      codes = [],
      validUntil,
      maxPerUser,
      validDays = [],
    } = req.body || {};

    const normalizedProductIds = normalizeStripeProductIds(productIds);
    const couponTemplateId = couponId === undefined ? null : couponId;

    if (!couponType) {
      return res.status(400).json({
        success: false,
        error: "couponType es requerido para sincronizar y persistir la plantilla",
      });
    }

    const response = await fetch(`${URL_MICROSTRIPE}/promotion-codes/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        couponId: couponTemplateId,
        couponType,
        customerId,
        productIds: normalizedProductIds,
        percentOff,
        amountOff,
        currency,
        duration,
        name,
        codes,
        validUntil,
        maxPerUser,
        validDays,
      }),
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `Stripe service returned ${response.status}`,
      });
    }

    const result = await response.json();
    const stripeCouponId = result.new_coupon_id || result.coupon?.id || result.data?.new_coupon_id || result.data?.coupon?.id || null;

    await prisma.couponTemplate.update({
      where: { couponType },
      data: {
        stripe_coupon_id: stripeCouponId,
        stripe_product_id: normalizedProductIds,
      },
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error syncing coupons with Stripe:", error);
    next(error);
  }
};

module.exports = {
  list,
  getByType,
  create,
  update,
  remove,
  uploadImage,
  getProductsFromStripe,
  syncWithStripe
};
