/**
 * Notification Service
 * Maneja la creación, envío y gestión de notificaciones
 */

const prisma = require('../config/database');
const { emitToUser, emitToAdmins, isUserConnected } = require('../config/socket');
const emailService = require('./emailService');
const logger = require('../config/logger');

// Configuración de notificaciones por tipo
const NOTIFICATION_CONFIG = {
  LEAD_NEW: {
    title: 'Nuevo Lead',
    sendEmail: true,
    emailTemplate: 'new_lead',
  },
  LEAD_STATUS_CHANGED: {
    title: 'Lead Actualizado',
    sendEmail: false,
  },
  DEAL_CLOSED: {
    title: '¡Venta Cerrada!',
    sendEmail: true,
    emailTemplate: 'deal_closed',
  },
  COMMISSION_APPROVED: {
    title: 'Comisión Aprobada',
    sendEmail: true,
    emailTemplate: 'commission_approved',
  },
  COMMISSION_PAID: {
    title: 'Comisión Pagada',
    sendEmail: true,
    emailTemplate: 'commission_paid',
  },
  PARTNER_REGISTERED: {
    title: '¡Bienvenido a EasyOrder Partners!',
    sendEmail: true,
    emailTemplate: 'welcome',
  },
  PARTNER_APPROVED: {
    title: '¡Bienvenido al Programa!',
    sendEmail: true,
    emailTemplate: 'partner_approved',
  },
  PARTNER_TIER_UPGRADE: {
    title: '¡Subiste de Nivel!',
    sendEmail: true,
    emailTemplate: 'tier_upgrade',
  },
  SYSTEM: {
    title: 'Notificación del Sistema',
    sendEmail: false,
  },
};

/**
 * Crear y enviar una notificación
 */
async function createNotification({
  userId,
  type,
  message,
  data = null,
  customTitle = null,
  skipEmail = false,
}) {
  try {
    const config = NOTIFICATION_CONFIG[type] || NOTIFICATION_CONFIG.SYSTEM;
    const title = customTitle || config.title;

    // Crear notificación en BD
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        data,
      },
      include: {
        user: {
          select: { email: true, name: true },
        },
      },
    });

    // Emitir via WebSocket si el usuario está conectado
    emitToUser(userId, 'notification:new', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      read: notification.read,
      createdAt: notification.createdAt,
    });

    // Enviar email si está configurado y el usuario no está conectado
    if (config.sendEmail && !skipEmail && config.emailTemplate) {
      // Enviar email async (no bloquear)
      emailService
        .sendTemplateEmail(config.emailTemplate, notification.user.email, {
          name: notification.user.name,
          title,
          message,
          ...data,
        })
        .catch((err) => logger.error('Error sending notification email:', err));
    }

    logger.info(`Notification created: ${type} for user ${userId}`);
    return notification;
  } catch (error) {
    logger.error('Error creating notification:', error);
    throw error;
  }
}

/**
 * Crear notificación para todos los admins
 */
async function notifyAdmins({ type, message, data = null, customTitle = null }) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });

    const notifications = await Promise.all(
      admins.map((admin) =>
        createNotification({
          userId: admin.id,
          type,
          message,
          data,
          customTitle,
          skipEmail: true, // Evitar spam de emails a admins
        })
      )
    );

    // Emitir a todos los admins conectados
    const config = NOTIFICATION_CONFIG[type] || NOTIFICATION_CONFIG.SYSTEM;
    emitToAdmins('notification:new', {
      type,
      title: customTitle || config.title,
      message,
      data,
      createdAt: new Date(),
    });

    return notifications;
  } catch (error) {
    logger.error('Error notifying admins:', error);
    throw error;
  }
}

/**
 * Obtener notificaciones de un usuario
 */
async function getUserNotifications(userId, { page = 1, limit = 20, unreadOnly = false }) {
  const where = { userId };
  if (unreadOnly) {
    where.read = false;
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    data: notifications,
    total,
    page,
    pageSize: limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Obtener contador de notificaciones no leídas
 */
async function getUnreadCount(userId) {
  return prisma.notification.count({
    where: { userId, read: false },
  });
}

/**
 * Marcar notificación como leída
 */
async function markAsRead(notificationId, userId) {
  return prisma.notification.update({
    where: { id: notificationId, userId },
    data: { read: true, readAt: new Date() },
  });
}

/**
 * Marcar todas las notificaciones como leídas
 */
async function markAllAsRead(userId) {
  return prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true, readAt: new Date() },
  });
}

/**
 * Eliminar notificación
 */
async function deleteNotification(notificationId, userId) {
  return prisma.notification.delete({
    where: { id: notificationId, userId },
  });
}

/**
 * Eliminar notificaciones antiguas (limpieza)
 */
async function cleanOldNotifications(daysOld = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await prisma.notification.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
      read: true,
    },
  });

  logger.info(`Cleaned ${result.count} old notifications`);
  return result.count;
}

// ========================================
// Helpers para eventos específicos
// ========================================

/**
 * Notificar nuevo lead al partner
 */
async function notifyNewLead(partnerId, lead) {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { userId: true },
  });

  if (partner) {
    await createNotification({
      userId: partner.userId,
      type: 'LEAD_NEW',
      message: `Nuevo lead: ${lead.businessName}`,
      data: {
        leadId: lead.id,
        businessName: lead.businessName,
        contactName: lead.contactName,
      },
    });
  }
}

/**
 * Notificar cambio de estado de lead
 */
async function notifyLeadStatusChange(partnerId, lead, oldStatus, newStatus) {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { userId: true },
  });

  if (partner) {
    await createNotification({
      userId: partner.userId,
      type: 'LEAD_STATUS_CHANGED',
      message: `El lead "${lead.businessName}" cambió de ${oldStatus} a ${newStatus}`,
      data: {
        leadId: lead.id,
        businessName: lead.businessName,
        oldStatus,
        newStatus,
      },
    });
  }
}

/**
 * Notificar deal cerrado
 */
async function notifyDealClosed(partnerId, deal) {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { userId: true },
  });

  if (partner) {
    await createNotification({
      userId: partner.userId,
      type: 'DEAL_CLOSED',
      message: `¡Felicidades! Cerraste la venta de ${deal.businessName}`,
      data: {
        dealId: deal.id,
        businessName: deal.businessName,
        totalValue: deal.totalValue,
        commissionAmount: deal.commissionAmount,
      },
    });

    // También notificar a admins
    await notifyAdmins({
      type: 'DEAL_CLOSED',
      message: `Nuevo deal cerrado: ${deal.businessName}`,
      data: {
        dealId: deal.id,
        partnerId,
        businessName: deal.businessName,
        totalValue: deal.totalValue,
      },
    });
  }
}

/**
 * Notificar comisión aprobada
 */
async function notifyCommissionApproved(partnerId, commission) {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { userId: true },
  });

  if (partner) {
    await createNotification({
      userId: partner.userId,
      type: 'COMMISSION_APPROVED',
      message: `Tu comisión de $${commission.amount} ha sido aprobada`,
      data: {
        commissionId: commission.id,
        amount: commission.amount,
        type: commission.type,
      },
    });
  }
}

/**
 * Notificar comisión pagada
 */
async function notifyCommissionPaid(partnerId, commission) {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { userId: true },
  });

  if (partner) {
    await createNotification({
      userId: partner.userId,
      type: 'COMMISSION_PAID',
      message: `Se ha depositado tu comisión de $${commission.amount}`,
      data: {
        commissionId: commission.id,
        amount: commission.amount,
        paymentRef: commission.paymentRef,
      },
    });
  }
}

/**
 * Notificar partner registrado (email de bienvenida)
 */
async function notifyPartnerRegistered(userId, partner) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });

  if (user) {
    // Enviar email de bienvenida directamente
    try {
      await emailService.sendWelcomeEmail(
        user.email,
        user.name,
        partner.code,
        partner.referralLink
      );
      logger.info(`Welcome email sent to: ${user.email}`);
    } catch (error) {
      logger.error(`Failed to send welcome email to ${user.email}:`, error);
    }
  }
}

/**
 * Notificar partner aprobado
 */
async function notifyPartnerApproved(userId, partner) {
  await createNotification({
    userId,
    type: 'PARTNER_APPROVED',
    message: `¡Tu solicitud ha sido aprobada! Ya puedes comenzar a generar leads.`,
    data: {
      partnerId: partner.id,
      code: partner.code,
      referralLink: partner.referralLink,
    },
  });
}

/**
 * Notificar upgrade de tier
 */
async function notifyTierUpgrade(userId, partner, oldTier, newTier) {
  await createNotification({
    userId,
    type: 'PARTNER_TIER_UPGRADE',
    message: `¡Felicidades! Has subido de ${oldTier} a ${newTier}`,
    data: {
      partnerId: partner.id,
      oldTier,
      newTier,
      newCommissionRate: partner.commissionRate,
    },
  });
}

module.exports = {
  createNotification,
  notifyAdmins,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  cleanOldNotifications,
  // Event helpers
  notifyNewLead,
  notifyLeadStatusChange,
  notifyDealClosed,
  notifyCommissionApproved,
  notifyCommissionPaid,
  notifyPartnerRegistered,
  notifyPartnerApproved,
  notifyTierUpgrade,
};
