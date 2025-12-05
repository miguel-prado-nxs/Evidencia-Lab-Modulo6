/**
 * Training Controller
 * Controlador para la API de capacitación (LMS)
 */

const trainingService = require("../services/trainingService");
const logger = require("../config/logger");

// ========================================
// Partner endpoints
// ========================================

/**
 * GET /training/courses
 * Listar cursos disponibles
 */
async function listCourses(req, res, next) {
  try {
    const partnerId = req.user.partner?.id;
    const { page, limit } = req.query;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const result = await trainingService.getAvailableCourses(partnerId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("Error listing courses:", error);
    next(error);
  }
}

/**
 * GET /training/courses/:slug
 * Obtener detalle de curso
 */
async function getCourse(req, res, next) {
  try {
    const { slug } = req.params;
    const partnerId = req.user.partner?.id;

    const course = await trainingService.getCourseBySlug(slug, partnerId);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: "Curso no encontrado",
      });
    }

    res.json({ success: true, data: course });
  } catch (error) {
    logger.error("Error getting course:", error);
    next(error);
  }
}

/**
 * POST /training/courses/:id/enroll
 * Inscribirse en un curso
 */
async function enrollInCourse(req, res, next) {
  try {
    const { id } = req.params;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const enrollment = await trainingService.enrollInCourse(partnerId, id);

    res.json({
      success: true,
      data: enrollment,
      message: "Inscripción exitosa",
    });
  } catch (error) {
    logger.error("Error enrolling in course:", error);
    next(error);
  }
}

/**
 * GET /training/lessons/:id
 * Obtener detalle de lección
 */
async function getLesson(req, res, next) {
  try {
    const { id } = req.params;
    const partnerId = req.user.partner?.id;

    const lesson = await trainingService.getLesson(id, partnerId);

    if (!lesson) {
      return res.status(404).json({
        success: false,
        error: "Lección no encontrada",
      });
    }

    res.json({ success: true, data: lesson });
  } catch (error) {
    logger.error("Error getting lesson:", error);
    next(error);
  }
}

/**
 * POST /training/lessons/:id/complete
 * Marcar lección como completada
 */
async function completeLesson(req, res, next) {
  try {
    const { id } = req.params;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const progress = await trainingService.completeLesson(partnerId, id);

    res.json({
      success: true,
      data: progress,
      message: "Lección completada",
    });
  } catch (error) {
    logger.error("Error completing lesson:", error);
    next(error);
  }
}

/**
 * POST /training/lessons/:id/track-time
 * Registrar tiempo de video
 */
async function trackWatchTime(req, res, next) {
  try {
    const { id } = req.params;
    const { seconds } = req.body;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const progress = await trainingService.trackWatchTime(partnerId, id, seconds || 0);

    res.json({ success: true, data: progress });
  } catch (error) {
    logger.error("Error tracking watch time:", error);
    next(error);
  }
}

/**
 * GET /training/quizzes/:id
 * Obtener quiz
 */
async function getQuiz(req, res, next) {
  try {
    const { id } = req.params;

    const quiz = await trainingService.getQuiz(id);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        error: "Quiz no encontrado",
      });
    }

    res.json({ success: true, data: quiz });
  } catch (error) {
    logger.error("Error getting quiz:", error);
    next(error);
  }
}

/**
 * POST /training/quizzes/:id/submit
 * Enviar respuestas de quiz
 */
async function submitQuiz(req, res, next) {
  try {
    const { id } = req.params;
    const { answers } = req.body;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    if (!answers || typeof answers !== "object") {
      return res.status(400).json({
        success: false,
        error: "Las respuestas son requeridas",
      });
    }

    const result = await trainingService.submitQuizAnswers(partnerId, id, answers);

    res.json({
      success: true,
      data: result,
      message: result.passed ? "¡Felicidades! Aprobaste el quiz" : "No aprobaste, intenta de nuevo",
    });
  } catch (error) {
    logger.error("Error submitting quiz:", error);
    next(error);
  }
}

/**
 * GET /training/certificates
 * Obtener certificados del partner
 */
async function getCertificates(req, res, next) {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const certificates = await trainingService.getPartnerCertificates(partnerId);

    res.json({ success: true, data: certificates });
  } catch (error) {
    logger.error("Error getting certificates:", error);
    next(error);
  }
}

/**
 * GET /training/certificates/:code/verify
 * Verificar certificado (público)
 */
async function verifyCertificate(req, res, next) {
  try {
    const { code } = req.params;

    const result = await trainingService.verifyCertificate(code);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: "Certificado no encontrado o inválido",
      });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("Error verifying certificate:", error);
    next(error);
  }
}

/**
 * GET /training/certificates/:code/download
 * Descargar PDF del certificado
 */
async function downloadCertificate(req, res, next) {
  try {
    const { code } = req.params;
    const certificateService = require("../services/certificateService");
    const prisma = require("../config/database");
    const fs = require("fs");

    // Verificar que el certificado existe
    const certificate = await prisma.certificate.findUnique({
      where: { code },
      include: {
        partner: {
          include: { user: { select: { name: true } } },
        },
        course: { select: { title: true } },
      },
    });

    if (!certificate) {
      return res.status(404).json({
        success: false,
        error: "Certificado no encontrado",
      });
    }

    // Generar PDF si no existe
    let pdfPath = certificateService.getCertificatePath(code);
    if (!certificateService.certificatePdfExists(code)) {
      pdfPath = await certificateService.generateCertificatePdf(certificate);
    }

    // Enviar archivo
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="certificado_${code}.pdf"`
    );

    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);
  } catch (error) {
    logger.error("Error downloading certificate:", error);
    next(error);
  }
}

/**
 * GET /training/progress
 * Obtener progreso general del partner
 */
async function getProgress(req, res, next) {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: "No tienes un perfil de partner asociado",
      });
    }

    const progress = await trainingService.getPartnerProgress(partnerId);

    res.json({ success: true, data: progress });
  } catch (error) {
    logger.error("Error getting progress:", error);
    next(error);
  }
}

// ========================================
// Admin endpoints
// ========================================

/**
 * GET /training/admin/courses
 * Listar todos los cursos (admin)
 */
async function adminListCourses(req, res, next) {
  try {
    const { page, limit, includeUnpublished } = req.query;

    const result = await trainingService.getAllCourses({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      includeUnpublished: includeUnpublished !== "false",
    });

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("Error listing courses (admin):", error);
    next(error);
  }
}

/**
 * POST /training/admin/courses
 * Crear curso
 */
async function createCourse(req, res, next) {
  try {
    const course = await trainingService.createCourse(req.body);

    res.status(201).json({
      success: true,
      data: course,
      message: "Curso creado",
    });
  } catch (error) {
    logger.error("Error creating course:", error);
    next(error);
  }
}

/**
 * PATCH /training/admin/courses/:id
 * Actualizar curso
 */
async function updateCourse(req, res, next) {
  try {
    const { id } = req.params;

    const course = await trainingService.updateCourse(id, req.body);

    res.json({
      success: true,
      data: course,
      message: "Curso actualizado",
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Curso no encontrado",
      });
    }
    logger.error("Error updating course:", error);
    next(error);
  }
}

/**
 * DELETE /training/admin/courses/:id
 * Eliminar curso
 */
async function deleteCourse(req, res, next) {
  try {
    const { id } = req.params;

    await trainingService.deleteCourse(id);

    res.json({
      success: true,
      message: "Curso eliminado",
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Curso no encontrado",
      });
    }
    logger.error("Error deleting course:", error);
    next(error);
  }
}

/**
 * POST /training/admin/courses/:id/lessons
 * Crear lección
 */
async function createLesson(req, res, next) {
  try {
    const { id } = req.params;

    const lesson = await trainingService.createLesson(id, req.body);

    res.status(201).json({
      success: true,
      data: lesson,
      message: "Lección creada",
    });
  } catch (error) {
    logger.error("Error creating lesson:", error);
    next(error);
  }
}

/**
 * PATCH /training/admin/lessons/:id
 * Actualizar lección
 */
async function updateLesson(req, res, next) {
  try {
    const { id } = req.params;

    const lesson = await trainingService.updateLesson(id, req.body);

    res.json({
      success: true,
      data: lesson,
      message: "Lección actualizada",
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Lección no encontrada",
      });
    }
    logger.error("Error updating lesson:", error);
    next(error);
  }
}

/**
 * DELETE /training/admin/lessons/:id
 * Eliminar lección
 */
async function deleteLesson(req, res, next) {
  try {
    const { id } = req.params;

    await trainingService.deleteLesson(id);

    res.json({
      success: true,
      message: "Lección eliminada",
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Lección no encontrada",
      });
    }
    logger.error("Error deleting lesson:", error);
    next(error);
  }
}

/**
 * POST /training/admin/lessons/:id/quiz
 * Crear quiz
 */
async function createQuiz(req, res, next) {
  try {
    const { id } = req.params;

    const quiz = await trainingService.createQuiz(id, req.body);

    res.status(201).json({
      success: true,
      data: quiz,
      message: "Quiz creado",
    });
  } catch (error) {
    logger.error("Error creating quiz:", error);
    next(error);
  }
}

module.exports = {
  // Partner
  listCourses,
  getCourse,
  enrollInCourse,
  getLesson,
  completeLesson,
  trackWatchTime,
  getQuiz,
  submitQuiz,
  getCertificates,
  verifyCertificate,
  downloadCertificate,
  getProgress,
  // Admin
  adminListCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  createLesson,
  updateLesson,
  deleteLesson,
  createQuiz,
};

