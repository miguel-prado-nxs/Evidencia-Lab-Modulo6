/**
 * Notifications Routes
 * Rutas para el sistema de notificaciones
 */

const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notificationsController');
const { authenticateJWT, requireAdmin } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(authenticateJWT);

// Obtener notificaciones del usuario
router.get('/', notificationsController.list);

// Obtener cantidad de no leídas
router.get('/unread-count', notificationsController.getUnreadCount);

// Marcar todas como leídas
router.patch('/read-all', notificationsController.markAllAsRead);

// Marcar una como leída
router.patch('/:id/read', notificationsController.markAsRead);

// Eliminar notificación
router.delete('/:id', notificationsController.remove);

// Admin: enviar notificación de prueba
router.post('/test', requireAdmin, notificationsController.sendTest);

module.exports = router;
