/**
 * Notifications Controller
 * Controlador para la API de notificaciones
 */

const notificationService = require("../services/notificationService");
const logger = require("../config/logger");

/**
 * GET /notifications
 * Listar notificaciones del usuario
 */
async function list(req, res, next) {
  try {
    const userId = req.user.id;
    const { page, limit, unreadOnly } = req.query;

    const result = await notificationService.getUserNotifications(userId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      unreadOnly: unreadOnly === "true",
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Error listing notifications:", error);
    next(error);
  }
}

/**
 * GET /notifications/unread-count
 * Obtener cantidad de notificaciones no leídas
 */
async function getUnreadCount(req, res, next) {
  try {
    const userId = req.user.id;
    const count = await notificationService.getUnreadCount(userId);

    res.json({
      success: true,
      data: { count },
    });
  } catch (error) {
    logger.error("Error getting unread count:", error);
    next(error);
  }
}

/**
 * PATCH /notifications/:id/read
 * Marcar notificación como leída
 */
async function markAsRead(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const notification = await notificationService.markAsRead(id, userId);

    res.json({
      success: true,
      data: notification,
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Notificación no encontrada",
      });
    }
    logger.error("Error marking notification as read:", error);
    next(error);
  }
}

/**
 * PATCH /notifications/read-all
 * Marcar todas las notificaciones como leídas
 */
async function markAllAsRead(req, res, next) {
  try {
    const userId = req.user.id;
    const result = await notificationService.markAllAsRead(userId);

    res.json({
      success: true,
      message: `${result.count} notificaciones marcadas como leídas`,
      data: { count: result.count },
    });
  } catch (error) {
    logger.error("Error marking all notifications as read:", error);
    next(error);
  }
}

/**
 * DELETE /notifications/:id
 * Eliminar notificación
 */
async function remove(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    await notificationService.deleteNotification(id, userId);

    res.json({
      success: true,
      message: "Notificación eliminada",
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Notificación no encontrada",
      });
    }
    logger.error("Error deleting notification:", error);
    next(error);
  }
}

/**
 * POST /notifications/test (Admin only)
 * Enviar notificación de prueba
 */
async function sendTest(req, res, next) {
  try {
    const { userId, type, message } = req.body;

    if (!userId || !message) {
      return res.status(400).json({
        success: false,
        error: "userId y message son requeridos",
      });
    }

    const notification = await notificationService.createNotification({
      userId,
      type: type || "SYSTEM",
      message,
    });

    res.json({
      success: true,
      data: notification,
    });
  } catch (error) {
    logger.error("Error sending test notification:", error);
    next(error);
  }
}

module.exports = {
  list,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  remove,
  sendTest,
};

