/**
 * Resources Routes
 * Rutas para el sistema de recursos/materiales de ventas
 */

const express = require('express');
const router = express.Router();
const resourcesController = require('../controllers/resourcesController');
const { authenticateJWT, requireAdmin } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');

// Ruta pública para categorías
router.get('/categories', resourcesController.getCategories);

// Todas las demás rutas requieren autenticación
router.use(authenticateJWT);

// Listar recursos (filtrado por permisos del partner)
router.get('/', resourcesController.list);

// Obtener detalle de recurso
router.get('/:id', resourcesController.getById);

// Descargar archivo
router.get('/:id/download', resourcesController.download);

// Registrar descarga (para URLs externas)
router.post('/:id/track-download', resourcesController.trackDownload);

// Admin: crear recurso (con upload de archivo)
router.post('/', requireAdmin, uploadSingle, resourcesController.create);

// Admin: actualizar recurso
router.patch('/:id', requireAdmin, uploadSingle, resourcesController.update);

// Admin: eliminar recurso
router.delete('/:id', requireAdmin, resourcesController.remove);

module.exports = router;
