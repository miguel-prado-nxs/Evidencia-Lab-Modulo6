/**
 * Training Routes
 * Rutas para el sistema de capacitación (LMS)
 */

const express = require('express');
const router = express.Router();
const trainingController = require('../controllers/trainingController');
const { authenticateJWT, requireAdmin } = require('../middleware/auth');

// Ruta pública para verificar certificados
router.get('/certificates/:code/verify', trainingController.verifyCertificate);

// Rutas que requieren autenticación
router.use(authenticateJWT);

// ========================================
// Partner routes
// ========================================

// Cursos
router.get('/courses', trainingController.listCourses);
router.get('/courses/:slug', trainingController.getCourse);
router.post('/courses/:id/enroll', trainingController.enrollInCourse);

// Lecciones
router.get('/lessons/:id', trainingController.getLesson);
router.post('/lessons/:id/complete', trainingController.completeLesson);
router.post('/lessons/:id/track-time', trainingController.trackWatchTime);

// Quizzes
router.get('/quizzes/:id', trainingController.getQuiz);
router.post('/quizzes/:id/submit', trainingController.submitQuiz);

// Certificados y progreso
router.get('/certificates', trainingController.getCertificates);
router.get('/certificates/:code/download', trainingController.downloadCertificate);
router.get('/progress', trainingController.getProgress);

// ========================================
// Admin routes
// ========================================

// Listar todos los cursos (incluyendo no publicados)
router.get('/admin/courses', requireAdmin, trainingController.adminListCourses);

// CRUD de cursos
router.post('/admin/courses', requireAdmin, trainingController.createCourse);
router.patch('/admin/courses/:id', requireAdmin, trainingController.updateCourse);
router.delete('/admin/courses/:id', requireAdmin, trainingController.deleteCourse);

// Lecciones de curso
router.post('/admin/courses/:id/lessons', requireAdmin, trainingController.createLesson);
router.patch('/admin/lessons/:id', requireAdmin, trainingController.updateLesson);
router.delete('/admin/lessons/:id', requireAdmin, trainingController.deleteLesson);

// Quiz de lección
router.post('/admin/lessons/:id/quiz', requireAdmin, trainingController.createQuiz);

module.exports = router;
