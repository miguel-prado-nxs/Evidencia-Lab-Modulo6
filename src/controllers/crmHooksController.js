const { z } = require('zod');
const logger = require('../config/logger');

const bodySchema = z.object({
  action: z.string(),
  payload: z.object({ establishmentId: z.string() }).passthrough(),
  source: z.string().optional(),
  correlationId: z.string().optional(),
});

// Mapa de acciones - agregar nuevas accion = nueva entrada aqui
const ACTION_HANDLERS = {
  'send-whatsapp': async (payload) => {
    // TODO T027: implementar cuando se definan las reglas con marketing
    logger.info('[CrmHooksController] send-whatsapp recibido', {
      establishmentId: payload.establishmentId,
    });
    return { message: 'Accion ejecutada correctamente' };
  },
  'requeue-campaign': async (payload) => {
    // TODO T027: implementar cuando se definan las reglas con marketing
    logger.info('[CrmHooksController] requeue-campaign recibido', {
      establishmentId: payload.establishmentId,
      campaignId: payload.campaignId,
    });
    return { message: 'Accion ejecutada correctamente' };
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

    // Responder inmediatamente - acciones largas corren en background
    res.json({ success: true, action, result: { message: 'Accion ejecutada correctamente' } });

    // Ejecutar la accion de forma asincrona tras responder
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
