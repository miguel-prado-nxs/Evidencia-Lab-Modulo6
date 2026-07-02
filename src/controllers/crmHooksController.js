const { z } = require('zod');
const logger = require('../config/logger');
const crmHooksService = require('../services/crmHooksService');

const bodySchema = z.object({
  action: z.string(),
  payload: z.object({ establishmentId: z.string().optional() }).passthrough(),
  source: z.string().optional(),
  correlationId: z.string().optional(),
});

// Mapa de acciones — agregar nueva accion = nueva entrada aqui
const ACTION_HANDLERS = {
  'send-whatsapp': async (payload) => {
    return crmHooksService.sendWhatsapp({
      establishmentId: payload.establishmentId,
      templateName: payload.templateName,
    });
  },
  'requeue-campaign': async (payload) => {
    return crmHooksService.requeueCampaign({
      establishmentId: payload.establishmentId,
      campaignId: payload.campaignId,
      reason: payload.reason,
      lastContactDate: payload.lastContactDate,
    });
  },
  'check-coupon-reminders': async () => {
    return crmHooksService.checkCouponReminders();
  },
};

const handle = async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Body invalido',
      });
    }

    const { action, payload, source, correlationId } = parsed.data;

    logger.info('[CrmHooksController] accion recibida', { action, source, correlationId });

    const handler = ACTION_HANDLERS[action];
    if (!handler) {
      return res.status(422).json({
        success: false,
        error: `Accion no soportada: ${action}`,
      });
    }

    // Responder inmediatamente — acciones largas corren en background
    res.json({ success: true, action, result: { message: 'Accion ejecutada correctamente' } });

    handler(payload).catch((err) =>
      logger.error('[CrmHooksController] Error ejecutando accion', {
        action,
        source,
        correlationId,
        error: err.message,
      })
    );
  } catch (error) {
    next(error);
  }
};

module.exports = { handle };
