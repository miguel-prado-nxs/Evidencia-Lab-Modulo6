/**
 * Events Routes
 * Rutas para Server-Sent Events (SSE)
 *
 * Permite a los clientes suscribirse a eventos en tiempo real
 * sin necesidad de polling o WebSockets completos
 */

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const prisma = require('../config/database');
const {
  registerClient,
  unregisterClient,
  formatSSEMessage,
  getStats,
} = require('../config/sseEvents');

/**
 * Middleware especial para SSE que acepta autenticación via query params
 * (EventSource no soporta headers personalizados)
 */
async function authenticateSSE(req, res, next) {
  try {
    // Obtener credenciales de query params (para SSE) o headers (para fetch normal)
    const serviceKey = req.query.serviceKey || req.headers['x-service-key'];
    const salesUserId = req.query.salesUserId || req.headers['x-sales-user-id'] || 'ventas-default';
    const salesUserName =
      req.query.salesUserName || req.headers['x-sales-user-name'] || 'Equipo Ventas';
    const salesUserEmail =
      req.query.salesUserEmail || req.headers['x-sales-user-email'] || 'ventas@easyorder.mx';
    const salesUserRole = req.query.salesUserRole || req.headers['x-sales-user-role'] || 'rep';

    if (!serviceKey) {
      return res.status(401).json({
        success: false,
        error: 'Service key requerida',
      });
    }

    // Verificar la clave de servicio
    const validServiceKey = process.env.VENTAS_SERVICE_KEY || 'ventas-easyorder-2024';
    if (serviceKey !== validServiceKey) {
      return res.status(401).json({
        success: false,
        error: 'Service key inválida',
      });
    }

    // Buscar el partner de Ventas
    let salesPartner = await prisma.partner.findUnique({
      where: { code: `VENTAS-${salesUserId}` },
    });

    if (!salesPartner) {
      // Si no existe, intentar encontrar por email
      const existingUser = await prisma.user.findUnique({
        where: { email: salesUserEmail },
      });

      if (existingUser) {
        salesPartner = await prisma.partner.findUnique({
          where: { userId: existingUser.id },
        });
      }

      // Si aún no existe, crear usuario y partner
      if (!salesPartner) {
        const bcrypt = require('bcryptjs');
        const passwordHash = await bcrypt.hash('ventas-internal-' + Date.now(), 10);

        const newUser = await prisma.user.create({
          data: {
            email: salesUserEmail,
            name: salesUserName,
            passwordHash,
            role: 'PARTNER',
          },
        });

        const referralCode = `VENTAS-${salesUserId}-${Date.now().toString(36)}`;
        salesPartner = await prisma.partner.create({
          data: {
            userId: newUser.id,
            code: `VENTAS-${salesUserId}`,
            type: 'TECHNOLOGY',
            companyName: 'EasyOrder Ventas',
            status: 'ACTIVE',
            tier: 'ELITE',
            referralLink: referralCode,
          },
        });
      }
    }

    // Asignar datos al request
    req.salesPartnerId = salesPartner.id;
    req.salesUserRole = salesUserRole;
    req.user = { partner: { id: salesPartner.id } };

    logger.info(`[SSE Auth] Usuario autenticado: ${salesUserEmail}, PartnerId: ${salesPartner.id}`);
    next();
  } catch (error) {
    logger.error('[SSE Auth] Error de autenticación:', error);
    return res.status(500).json({
      success: false,
      error: 'Error de autenticación SSE: ' + error.message,
    });
  }
}

/**
 * GET /api/v1/events/enrichments
 * Suscribirse a eventos de enriquecimiento en tiempo real
 *
 * El cliente mantiene una conexión abierta y recibe eventos cuando:
 * - Un enriquecimiento se actualiza
 * - Un establecimiento cambia de nivel (CONTACT -> PROSPECT -> LEAD -> CLIENT)
 *
 * Eventos emitidos:
 * - enrichment:updated - Cuando se actualiza cualquier dato del enriquecimiento
 * - enrichment:level-changed - Cuando cambia el nivel del establecimiento
 *
 * Query params requeridos (para SSE):
 * - serviceKey: Clave de servicio
 * - salesUserId: ID del usuario de ventas
 * - salesUserName: Nombre del usuario
 * - salesUserEmail: Email del usuario
 * - salesUserRole: Rol del usuario
 */
router.get('/enrichments', authenticateSSE, (req, res) => {
  // Obtener partnerId del usuario autenticado
  const partnerId = req.salesPartnerId || req.user?.partner?.id;

  if (!partnerId) {
    return res.status(403).json({
      success: false,
      error: 'Se requiere autenticación de partner para suscribirse a eventos',
    });
  }

  // Configurar headers para SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Para nginx
  res.setHeader('Access-Control-Allow-Origin', '*'); // CORS

  // Deshabilitar timeout para conexiones largas
  req.setTimeout(0);
  res.setTimeout(0);

  // Enviar evento de conexión establecida
  res.write(
    formatSSEMessage('connected', {
      partnerId,
      message: 'Conexión SSE establecida',
      timestamp: new Date().toISOString(),
    })
  );

  // Registrar cliente
  registerClient(partnerId, res);

  // Heartbeat para mantener conexión viva (cada 30 segundos)
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(
        formatSSEMessage('heartbeat', {
          timestamp: new Date().toISOString(),
        })
      );
    } catch (error) {
      logger.error(`[SSE] Error en heartbeat: ${error.message}`);
      clearInterval(heartbeatInterval);
    }
  }, 30000);

  // Manejar desconexión del cliente
  req.on('close', () => {
    logger.info(`[SSE] Cliente desconectado: partner ${partnerId}`);
    clearInterval(heartbeatInterval);
    unregisterClient(partnerId, res);
  });

  // Manejar errores
  req.on('error', (error) => {
    logger.error(`[SSE] Error en conexión: ${error.message}`);
    clearInterval(heartbeatInterval);
    unregisterClient(partnerId, res);
  });

  logger.info(`[SSE] Cliente conectado: partner ${partnerId}`);
});

/**
 * GET /api/v1/events/stats
 * Obtener estadísticas de conexiones SSE (solo admin)
 */
router.get('/stats', authenticateSSE, (req, res) => {
  const salesUserRole = req.salesUserRole;

  // Solo admins pueden ver estadísticas
  if (salesUserRole !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Se requiere rol de administrador',
    });
  }

  res.json({
    success: true,
    data: getStats(),
  });
});

module.exports = router;
