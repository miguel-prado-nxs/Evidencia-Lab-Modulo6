/**
 * Training Service
 * Lógica de negocio para el sistema de capacitación (LMS)
 */

const prisma = require('../config/database');
const logger = require('../config/logger');

// Orden de tiers para validación de acceso
const TIER_ORDER = ['REGISTERED', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];

/**
 * Obtener cursos disponibles para un partner
 */
async function getAvailableCourses(partnerId, options = {}) {
  const { page = 1, limit = 20, includeProgress = true } = options;

  // Obtener info del partner
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { tier: true, type: true },
  });

  if (!partner) throw new Error('Partner no encontrado');

  const partnerTierIndex = TIER_ORDER.indexOf(partner.tier);
  const allowedTiers = TIER_ORDER.slice(0, partnerTierIndex + 1);

  // Filtrar cursos por tier y tipo de partner
  const where = {
    isPublished: true,
    minTier: { in: allowedTiers },
    OR: [{ partnerTypes: { isEmpty: true } }, { partnerTypes: { has: partner.type } }],
  };

  const [courses, total] = await Promise.all([
    prisma.course.findMany({
      where,
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { lessons: true } },
        ...(includeProgress && {
          enrollments: {
            where: { partnerId },
            select: { status: true, progress: true },
          },
        }),
      },
    }),
    prisma.course.count({ where }),
  ]);

  // Transformar datos
  const coursesWithProgress = courses.map((course) => ({
    ...course,
    lessonsCount: course._count.lessons,
    enrollment: course.enrollments?.[0] || null,
    _count: undefined,
    enrollments: undefined,
  }));

  return {
    data: coursesWithProgress,
    pagination: {
      page,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Obtener detalle de un curso
 */
async function getCourseBySlug(slug, partnerId = null) {
  const course = await prisma.course.findUnique({
    where: { slug },
    include: {
      lessons: {
        orderBy: { order: 'asc' },
        include: {
          quizzes: {
            select: { id: true, title: true, passingScore: true },
          },
          ...(partnerId && {
            progress: {
              where: { partnerId },
              select: { completed: true, completedAt: true, watchTime: true },
            },
          }),
        },
      },
      _count: { select: { enrollments: true } },
      ...(partnerId && {
        enrollments: {
          where: { partnerId },
        },
      }),
    },
  });

  if (!course) return null;

  // Transformar lecciones para incluir progreso
  const lessonsWithProgress = course.lessons.map((lesson) => ({
    ...lesson,
    progress: lesson.progress?.[0] || null,
    hasQuiz: lesson.quizzes.length > 0,
    quizzes: lesson.quizzes,
  }));

  return {
    ...course,
    lessons: lessonsWithProgress,
    enrollment: course.enrollments?.[0] || null,
    enrollmentsCount: course._count.enrollments,
    _count: undefined,
    enrollments: undefined,
  };
}

/**
 * Inscribir partner en un curso
 */
async function enrollInCourse(partnerId, courseId) {
  // Verificar si ya está inscrito
  const existing = await prisma.courseEnrollment.findUnique({
    where: { partnerId_courseId: { partnerId, courseId } },
  });

  if (existing) {
    return existing;
  }

  // Crear inscripción
  const enrollment = await prisma.courseEnrollment.create({
    data: {
      partnerId,
      courseId,
      status: 'IN_PROGRESS',
      progress: 0,
    },
  });

  logger.info(`Partner ${partnerId} enrolled in course ${courseId}`);
  return enrollment;
}

/**
 * Obtener detalle de una lección
 */
async function getLesson(lessonId, partnerId = null) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      course: {
        select: { id: true, title: true, slug: true },
      },
      quizzes: {
        include: {
          questions: {
            orderBy: { order: 'asc' },
          },
        },
      },
      ...(partnerId && {
        progress: {
          where: { partnerId },
        },
      }),
    },
  });

  if (!lesson) return null;

  return {
    ...lesson,
    progress: lesson.progress?.[0] || null,
  };
}

/**
 * Marcar lección como completada
 */
async function completeLesson(partnerId, lessonId) {
  // Obtener o crear progreso de lección
  const progress = await prisma.lessonProgress.upsert({
    where: { partnerId_lessonId: { partnerId, lessonId } },
    create: {
      partnerId,
      lessonId,
      completed: true,
      completedAt: new Date(),
    },
    update: {
      completed: true,
      completedAt: new Date(),
    },
  });

  // Actualizar progreso del curso
  await updateCourseProgress(partnerId, lessonId);

  logger.info(`Partner ${partnerId} completed lesson ${lessonId}`);
  return progress;
}

/**
 * Registrar tiempo de video
 */
async function trackWatchTime(partnerId, lessonId, seconds) {
  const progress = await prisma.lessonProgress.upsert({
    where: { partnerId_lessonId: { partnerId, lessonId } },
    create: {
      partnerId,
      lessonId,
      watchTime: seconds,
    },
    update: {
      watchTime: { increment: seconds },
    },
  });

  return progress;
}

/**
 * Actualizar progreso del curso basado en lecciones completadas
 */
async function updateCourseProgress(partnerId, lessonId) {
  // Obtener curso de la lección
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { courseId: true },
  });

  if (!lesson) return;

  // Contar lecciones totales y completadas
  const [totalLessons, completedLessons] = await Promise.all([
    prisma.lesson.count({ where: { courseId: lesson.courseId } }),
    prisma.lessonProgress.count({
      where: {
        partnerId,
        completed: true,
        lesson: { courseId: lesson.courseId },
      },
    }),
  ]);

  // Calcular porcentaje
  const progress = Math.round((completedLessons / totalLessons) * 100);
  const isCompleted = progress === 100;

  // Actualizar enrollment
  await prisma.courseEnrollment.update({
    where: {
      partnerId_courseId: { partnerId, courseId: lesson.courseId },
    },
    data: {
      progress,
      status: isCompleted ? 'COMPLETED' : 'IN_PROGRESS',
      completedAt: isCompleted ? new Date() : null,
    },
  });

  // Si completó el curso, generar certificado
  if (isCompleted) {
    await generateCertificate(partnerId, lesson.courseId);
  }
}

/**
 * Obtener quiz
 */
async function getQuiz(quizId) {
  return prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      questions: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          question: true,
          options: true,
          order: true,
          // NO incluir correctOption para evitar trampa
        },
      },
      lesson: {
        select: { id: true, title: true, courseId: true },
      },
    },
  });
}

/**
 * Enviar respuestas de quiz
 */
async function submitQuizAnswers(partnerId, quizId, answers) {
  // Obtener quiz con respuestas correctas
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      questions: true,
      lesson: { select: { id: true } },
    },
  });

  if (!quiz) throw new Error('Quiz no encontrado');

  // Calcular score
  let correctCount = 0;
  quiz.questions.forEach((question) => {
    if (answers[question.id] === question.correctOption) {
      correctCount++;
    }
  });

  const score = Math.round((correctCount / quiz.questions.length) * 100);
  const passed = score >= quiz.passingScore;

  // Guardar intento
  const attempt = await prisma.quizAttempt.create({
    data: {
      partnerId,
      quizId,
      score,
      passed,
      answers,
    },
  });

  // Si pasó, marcar lección como completada
  if (passed) {
    await completeLesson(partnerId, quiz.lesson.id);
  }

  logger.info(`Partner ${partnerId} submitted quiz ${quizId}: score=${score}, passed=${passed}`);

  return {
    ...attempt,
    correctCount,
    totalQuestions: quiz.questions.length,
    passingScore: quiz.passingScore,
    // Incluir explicaciones solo si pasó
    explanations: passed
      ? quiz.questions.reduce((acc, q) => {
          acc[q.id] = {
            correct: q.correctOption,
            explanation: q.explanation,
          };
          return acc;
        }, {})
      : null,
  };
}

/**
 * Generar certificado
 */
async function generateCertificate(partnerId, courseId) {
  // Verificar si ya existe
  const existing = await prisma.certificate.findUnique({
    where: { partnerId_courseId: { partnerId, courseId } },
  });

  if (existing) return existing;

  // Generar código único
  const code = `CERT-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .substring(2, 6)
    .toUpperCase()}`;

  const certificate = await prisma.certificate.create({
    data: {
      partnerId,
      courseId,
      code,
    },
    include: {
      partner: {
        include: { user: { select: { name: true, email: true } } },
      },
      course: { select: { title: true } },
    },
  });

  logger.info(`Certificate generated: ${code} for partner ${partnerId}`);

  // TODO: Generar PDF del certificado
  // await certificateService.generatePdf(certificate);

  return certificate;
}

/**
 * Verificar certificado
 */
async function verifyCertificate(code) {
  const certificate = await prisma.certificate.findUnique({
    where: { code },
    include: {
      partner: {
        include: { user: { select: { name: true } } },
      },
      course: { select: { title: true } },
    },
  });

  if (!certificate) return null;

  return {
    valid: true,
    code: certificate.code,
    issuedAt: certificate.issuedAt,
    partnerName: certificate.partner.user.name,
    courseName: certificate.course.title,
  };
}

/**
 * Obtener certificados de un partner
 */
async function getPartnerCertificates(partnerId) {
  return prisma.certificate.findMany({
    where: { partnerId },
    include: {
      course: {
        select: { id: true, title: true, slug: true, thumbnailUrl: true },
      },
    },
    orderBy: { issuedAt: 'desc' },
  });
}

/**
 * Obtener progreso general del partner
 */
async function getPartnerProgress(partnerId) {
  const [enrollments, certificates, totalWatchTime] = await Promise.all([
    prisma.courseEnrollment.findMany({
      where: { partnerId },
      include: {
        course: {
          select: { id: true, title: true, slug: true, thumbnailUrl: true },
        },
      },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.certificate.count({ where: { partnerId } }),
    prisma.lessonProgress.aggregate({
      where: { partnerId },
      _sum: { watchTime: true },
    }),
  ]);

  const inProgress = enrollments.filter((e) => e.status === 'IN_PROGRESS');
  const completed = enrollments.filter((e) => e.status === 'COMPLETED');

  return {
    totalEnrollments: enrollments.length,
    inProgress: inProgress.length,
    completed: completed.length,
    certificates,
    totalWatchTime: totalWatchTime._sum.watchTime || 0,
    enrollments,
  };
}

// ========================================
// Admin functions
// ========================================

/**
 * Obtener todos los cursos (admin)
 */
async function getAllCourses(options = {}) {
  const { page = 1, limit = 20, includeUnpublished = true } = options;

  const where = includeUnpublished ? {} : { isPublished: true };

  const [courses, total] = await Promise.all([
    prisma.course.findMany({
      where,
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: {
          select: {
            lessons: true,
            enrollments: true,
            certificates: true,
          },
        },
      },
    }),
    prisma.course.count({ where }),
  ]);

  return {
    data: courses,
    pagination: {
      page,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Crear curso
 */
async function createCourse(data) {
  const { title, description, thumbnailUrl, duration, difficulty, minTier, partnerTypes } = data;

  // Generar slug
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  // Verificar si slug existe
  const existing = await prisma.course.findUnique({ where: { slug } });
  const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

  const course = await prisma.course.create({
    data: {
      title,
      slug: finalSlug,
      description,
      thumbnailUrl,
      duration: duration || 0,
      difficulty: difficulty || 'BEGINNER',
      minTier: minTier || 'REGISTERED',
      partnerTypes: partnerTypes || [],
    },
  });

  logger.info(`Course created: ${course.id} - ${course.title}`);
  return course;
}

/**
 * Actualizar curso
 */
async function updateCourse(id, data) {
  const course = await prisma.course.update({
    where: { id },
    data,
  });

  logger.info(`Course updated: ${id}`);
  return course;
}

/**
 * Eliminar curso
 */
async function deleteCourse(id) {
  await prisma.course.delete({ where: { id } });
  logger.info(`Course deleted: ${id}`);
}

/**
 * Crear lección
 */
async function createLesson(courseId, data) {
  const { title, description, content, videoUrl, duration } = data;

  // Generar slug
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  // Obtener orden
  const lastLesson = await prisma.lesson.findFirst({
    where: { courseId },
    orderBy: { order: 'desc' },
  });
  const order = (lastLesson?.order || 0) + 1;

  const lesson = await prisma.lesson.create({
    data: {
      courseId,
      title,
      slug,
      description,
      content: content || '',
      videoUrl,
      duration: duration || 0,
      order,
    },
  });

  // Actualizar duración total del curso
  await updateCourseDuration(courseId);

  logger.info(`Lesson created: ${lesson.id} - ${lesson.title}`);
  return lesson;
}

/**
 * Actualizar lección
 */
async function updateLesson(id, data) {
  const lesson = await prisma.lesson.update({
    where: { id },
    data,
  });

  if (data.duration !== undefined) {
    await updateCourseDuration(lesson.courseId);
  }

  logger.info(`Lesson updated: ${id}`);
  return lesson;
}

/**
 * Eliminar lección
 */
async function deleteLesson(id) {
  const lesson = await prisma.lesson.findUnique({
    where: { id },
    select: { courseId: true },
  });

  await prisma.lesson.delete({ where: { id } });

  if (lesson) {
    await updateCourseDuration(lesson.courseId);
  }

  logger.info(`Lesson deleted: ${id}`);
}

/**
 * Actualizar duración total del curso
 */
async function updateCourseDuration(courseId) {
  const result = await prisma.lesson.aggregate({
    where: { courseId },
    _sum: { duration: true },
  });

  await prisma.course.update({
    where: { id: courseId },
    data: { duration: result._sum.duration || 0 },
  });
}

/**
 * Crear quiz para lección
 */
async function createQuiz(lessonId, data) {
  const { title, passingScore, questions } = data;

  const quiz = await prisma.quiz.create({
    data: {
      lessonId,
      title,
      passingScore: passingScore || 70,
      questions: {
        create: questions.map((q, index) => ({
          question: q.question,
          options: q.options,
          correctOption: q.correctOption,
          explanation: q.explanation,
          order: index + 1,
        })),
      },
    },
    include: { questions: true },
  });

  logger.info(`Quiz created: ${quiz.id} for lesson ${lessonId}`);
  return quiz;
}

module.exports = {
  // Partner functions
  getAvailableCourses,
  getCourseBySlug,
  enrollInCourse,
  getLesson,
  completeLesson,
  trackWatchTime,
  getQuiz,
  submitQuizAnswers,
  getPartnerCertificates,
  getPartnerProgress,
  verifyCertificate,
  // Admin functions
  getAllCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  createLesson,
  updateLesson,
  deleteLesson,
  createQuiz,
};
