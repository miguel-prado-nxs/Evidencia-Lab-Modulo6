/**
 * Socket.io Configuration
 * Maneja conexiones WebSocket para notificaciones en tiempo real
 */

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const config = require("./env");
const logger = require("./logger");

let io = null;

// Mapa de usuarios conectados: userId -> Set de socketIds
const connectedUsers = new Map();

/**
 * Inicializar Socket.io con el servidor HTTP
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.security.allowedOrigins,
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Middleware de autenticación
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(" ")[1];

      if (!token) {
        return next(new Error("Token de autenticación requerido"));
      }

      const decoded = jwt.verify(token, config.auth.jwtSecret);
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;
      next();
    } catch (error) {
      logger.error("Socket auth error:", error.message);
      next(new Error("Token inválido"));
    }
  });

  // Manejo de conexiones
  io.on("connection", (socket) => {
    const userId = socket.userId;
    logger.info(`Socket connected: ${socket.id} for user ${userId}`);

    // Agregar socket al mapa de usuarios conectados
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket.id);

    // Unir al room del usuario (para notificaciones personales)
    socket.join(`user:${userId}`);

    // Si es admin, unir al room de admins
    if (socket.userRole === "ADMIN") {
      socket.join("admins");
    }

    // Manejar desconexión
    socket.on("disconnect", (reason) => {
      logger.info(`Socket disconnected: ${socket.id} - ${reason}`);

      const userSockets = connectedUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          connectedUsers.delete(userId);
        }
      }
    });

    // Marcar notificación como leída via socket
    socket.on("notification:read", async (notificationId) => {
      try {
        const prisma = require("./database");
        await prisma.notification.update({
          where: { id: notificationId, userId },
          data: { read: true, readAt: new Date() },
        });
        socket.emit("notification:read:success", notificationId);
      } catch (error) {
        logger.error("Error marking notification as read:", error);
        socket.emit("notification:read:error", notificationId);
      }
    });

    // Marcar todas las notificaciones como leídas
    socket.on("notifications:read-all", async () => {
      try {
        const prisma = require("./database");
        await prisma.notification.updateMany({
          where: { userId, read: false },
          data: { read: true, readAt: new Date() },
        });
        socket.emit("notifications:read-all:success");
      } catch (error) {
        logger.error("Error marking all notifications as read:", error);
        socket.emit("notifications:read-all:error");
      }
    });
  });

  logger.info("Socket.io initialized");
  return io;
}

/**
 * Obtener la instancia de Socket.io
 */
function getIO() {
  if (!io) {
    throw new Error("Socket.io not initialized. Call initSocket first.");
  }
  return io;
}

/**
 * Enviar notificación a un usuario específico
 */
function emitToUser(userId, event, data) {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
    logger.debug(`Emitted ${event} to user ${userId}`);
  }
}

/**
 * Enviar notificación a todos los admins
 */
function emitToAdmins(event, data) {
  if (io) {
    io.to("admins").emit(event, data);
    logger.debug(`Emitted ${event} to admins`);
  }
}

/**
 * Verificar si un usuario está conectado
 */
function isUserConnected(userId) {
  return connectedUsers.has(userId) && connectedUsers.get(userId).size > 0;
}

/**
 * Obtener lista de usuarios conectados
 */
function getConnectedUsers() {
  return Array.from(connectedUsers.keys());
}

module.exports = {
  initSocket,
  getIO,
  emitToUser,
  emitToAdmins,
  isUserConnected,
  getConnectedUsers,
};

