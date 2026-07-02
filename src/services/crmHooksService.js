const prisma = require('../config/database');
const logger = require('../config/logger');
const { resendCoupon } = require('./couponWhatsappService');

/**
 * Agrega un establecimiento a una campaña si no está ya en cola.
 * Solo aplica a campañas en estado READY o IN_PROGRESS.
 * Obtiene el teléfono del enrichment para pre-poblar el contacto.
 */
const REQUEUE_DAYS_THRESHOLD = 30;

/**
 * Verifica si una fecha supera el umbral de días sin contacto.
 * Retorna true si han pasado más de REQUEUE_DAYS_THRESHOLD días desde lastContactDate.
 */
const excedsNoContactThreshold = (lastContactDate) => {
  if (!lastContactDate) return false;
  const diffMs = Date.now() - new Date(lastContactDate).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > REQUEUE_DAYS_THRESHOLD;
};

const requeueCampaign = async ({ establishmentId, campaignId, reason, lastContactDate }) => {
  // Validar umbral de 30 días si viene la fecha del Workflow
  if (lastContactDate && !excedsNoContactThreshold(lastContactDate)) {
    logger.info('[CrmHooksService:requeueCampaign] Menos de 30 dias sin contacto, skip', {
      establishmentId,
      lastContactDate,
    });
    return { skipped: true, reason: 'menos_de_30_dias' };
  }

  // Si no viene campaignId, buscar la campaña Discovery activa automáticamente
  let campaign;
  if (campaignId) {
    campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, name: true },
    });
    if (!campaign) throw new Error(`Campana no encontrada: ${campaignId}`);
  } else {
    campaign = await prisma.campaign.findFirst({
      where: { type: 'DISCOVERY', status: { in: ['READY', 'IN_PROGRESS'] } },
      select: { id: true, status: true, name: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!campaign) {
      logger.warn('[CrmHooksService:requeueCampaign] Sin campana Discovery activa, skip', {
        establishmentId,
      });
      return { skipped: true, reason: 'sin_campana_discovery_activa' };
    }
  }

  if (!['READY', 'IN_PROGRESS'].includes(campaign.status)) {
    throw new Error(`Campana en estado invalido para reagendar: ${campaign.status}`);
  }

  // Evitar duplicados: skip si ya hay un contacto activo para este establecimiento
  const existing = await prisma.campaignContact.findFirst({
    where: {
      campaignId,
      establishmentId,
      status: { in: ['PENDING', 'SCHEDULED', 'CALLING'] },
    },
  });

  if (existing) {
    logger.info('[CrmHooksService:requeueCampaign] Establecimiento ya en cola, skip', {
      establishmentId,
      campaignId,
      existingContactId: existing.id,
    });
    return { skipped: true, reason: 'ya_en_cola' };
  }

  const enrichment = await prisma.establishmentEnrichment.findUnique({
    where: { establishmentId },
    select: { decisionMakerPhone: true, decisionMakerWhatsApp: true },
  });

  const phone = enrichment?.decisionMakerPhone || enrichment?.decisionMakerWhatsApp || null;

  await prisma.campaignContact.create({
    data: {
      campaignId,
      establishmentId,
      establishmentPhone: phone,
      status: 'PENDING',
      sourceType: 'CRM_HOOK',
      establishmentData: { reason: reason || 'crm_hook_requeue' },
    },
  });

  logger.info('[CrmHooksService:requeueCampaign] Establecimiento reagendado', {
    establishmentId,
    campaignId,
    campaignName: campaign.name,
    reason,
  });

  return { queued: true, campaignId, campaignName: campaign.name };
};

/**
 * Envía un WhatsApp según el template indicado.
 * Template 'recordatorio_cupon': reenvía el cupón activo (SENT, no vencido) del establecimiento.
 */
const sendWhatsapp = async ({ establishmentId, templateName }) => {
  if (templateName === 'recordatorio_cupon') {
    // Buscar el CampaignContact más reciente que tenga un cupón activo no vencido
    const contactWithCoupon = await prisma.campaignContact.findFirst({
      where: {
        establishmentId,
        coupon: {
          status: 'SENT',
          expiresAt: { gt: new Date() },
        },
      },
      include: { coupon: true },
      orderBy: { createdAt: 'desc' },
    });

    const coupon = contactWithCoupon?.coupon;

    if (!coupon) {
      logger.warn('[CrmHooksService:sendWhatsapp] Sin cupon activo para recordatorio', {
        establishmentId,
      });
      return { skipped: true, reason: 'sin_cupon_activo' };
    }

    if (!coupon.assignedPhone) {
      throw new Error(`Cupon ${coupon.id} no tiene telefono asignado`);
    }

    const result = await resendCoupon(coupon.id, coupon.assignedPhone);

    if (!result.success) {
      throw new Error(result.error || 'Error al reenviar cupon via WhatsApp');
    }

    logger.info('[CrmHooksService:sendWhatsapp] Recordatorio de cupon enviado', {
      establishmentId,
      couponId: coupon.id,
      phone: coupon.assignedPhone,
    });

    return { sent: true, couponId: coupon.id };
  }

  throw new Error(`Template de WhatsApp no implementado: ${templateName}`);
};

const COUPON_REMINDER_HOURS = 24;

/**
 * Busca cupones enviados hace más de 24h sin redimir y antes de vencer, y envía recordatorio por WhatsApp.
 * Se ejecuta como batch — pensado para ser disparado por un Workflow de Twenty sin payload.
 */
const checkCouponReminders = async () => {
  const thresholdDate = new Date(Date.now() - COUPON_REMINDER_HOURS * 60 * 60 * 1000);

  const coupons = await prisma.campaignCoupon.findMany({
    where: {
      status: 'SENT',
      sentAt: { lt: thresholdDate },
      expiresAt: { gt: new Date() },
      assignedPhone: { not: null },
    },
    select: { id: true, assignedPhone: true, sentAt: true, expiresAt: true },
  });

  if (coupons.length === 0) {
    logger.info('[CrmHooksService:checkCouponReminders] Sin cupones pendientes de recordatorio');
    return { processed: 0 };
  }

  logger.info('[CrmHooksService:checkCouponReminders] Procesando recordatorios', {
    total: coupons.length,
  });

  let sent = 0;
  let failed = 0;

  for (const coupon of coupons) {
    const result = await resendCoupon(coupon.id, coupon.assignedPhone);
    if (result.success) {
      sent++;
    } else {
      failed++;
      logger.warn('[CrmHooksService:checkCouponReminders] Error enviando recordatorio', {
        couponId: coupon.id,
        error: result.error,
      });
    }
  }

  logger.info('[CrmHooksService:checkCouponReminders] Recordatorios completados', {
    sent,
    failed,
  });

  return { processed: coupons.length, sent, failed };
};

module.exports = { requeueCampaign, sendWhatsapp, checkCouponReminders };
