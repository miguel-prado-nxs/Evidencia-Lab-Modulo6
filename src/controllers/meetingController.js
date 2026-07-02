/**
 * Meeting Controller
 * Controladores para la API de meetings de establecimientos
 */

const meetingService = require('../services/meetingService');
const logger = require('../config/logger');

/**
 * GET /api/v1/geo/meetings/:establishmentId
 * Obtener meeting de un establecimiento
 */
async function getMeeting(req, res, next) {
  try {
    const { establishmentId } = req.params;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'Solo partners pueden ver meetings',
      });
    }

    const meeting = await meetingService.getMeetingByEstablishment(establishmentId, partnerId);

    res.json({
      success: true,
      data: meeting,
    });
  } catch (error) {
    logger.error('Error en getMeeting:', error);
    next(error);
  }
}

/**
 * PATCH /api/v1/geo/meetings/:establishmentId
 * Actualizar meeting de un establecimiento
 */
async function updateMeeting(req, res, next) {
  try {
    const { establishmentId } = req.params;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'Solo partners pueden gestionar meetings',
      });
    }

    const { meetingScheduled, meetingDate, meetingLink, notes } = req.body;

    const meeting = await meetingService.upsertMeeting(establishmentId, partnerId, {
      meetingScheduled,
      meetingDate,
      meetingLink,
      notes,
    });

    res.json({
      success: true,
      data: meeting,
      message: meetingScheduled ? 'Meeting agendado correctamente' : 'Meeting cancelado',
    });
  } catch (error) {
    logger.error('Error en updateMeeting:', error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/meetings
 * Obtener meetings del partner autenticado en un rango de fechas
 */
async function getScheduledMeetings(req, res, next) {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'Solo partners pueden ver sus meetings',
      });
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren startDate y endDate',
      });
    }

    const meetings = await meetingService.getScheduledMeetings(partnerId, startDate, endDate);

    res.json({
      success: true,
      data: meetings,
    });
  } catch (error) {
    logger.error('Error en getScheduledMeetings:', error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/meetings/my
 * Obtener todos los meetings del partner autenticado
 */
async function getMyMeetings(req, res, next) {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'Solo partners pueden ver sus meetings',
      });
    }

    const { onlyScheduled } = req.query;

    const meetings = await meetingService.getMeetingsByPartner(partnerId, onlyScheduled === 'true');

    res.json({
      success: true,
      data: meetings,
      count: meetings.length,
    });
  } catch (error) {
    logger.error('Error en getMyMeetings:', error);
    next(error);
  }
}

/**
 * GET /api/v1/geo/meetings/stats
 * Obtener estadísticas de meetings del partner
 */
async function getMeetingStats(req, res, next) {
  try {
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'Solo partners pueden ver sus estadísticas',
      });
    }

    const stats = await meetingService.getMeetingStats(partnerId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Error en getMeetingStats:', error);
    next(error);
  }
}

/**
 * DELETE /api/v1/geo/meetings/:establishmentId
 * Eliminar meeting de un establecimiento
 */
async function deleteMeeting(req, res, next) {
  try {
    const { establishmentId } = req.params;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'Solo partners pueden eliminar meetings',
      });
    }

    const deleted = await meetingService.deleteMeeting(establishmentId, partnerId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Meeting no encontrado',
      });
    }

    res.json({
      success: true,
      message: 'Meeting eliminado correctamente',
    });
  } catch (error) {
    logger.error('Error en deleteMeeting:', error);
    next(error);
  }
}

/**
 * POST /api/v1/geo/meetings/:establishmentId/calendly
 * Crear meeting usando Calendly y guardarlo en BD
 * Requiere que el establecimiento tenga email registrado
 */
async function createMeetingWithCalendly(req, res, next) {
  try {
    const { establishmentId } = req.params;
    const partnerId = req.user.partner?.id;

    if (!partnerId) {
      return res.status(403).json({
        success: false,
        error: 'Solo partners pueden crear meetings',
      });
    }

    const { startTime, endTime, notes } = req.body;

    // Validar campos requeridos
    if (!startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren startTime y endTime en formato ISO 8601',
      });
    }

    const result = await meetingService.createMeetingWithCalendly(establishmentId, partnerId, {
      startTime,
      endTime,
      notes,
    });

    res.json({
      success: true,
      data: result.meeting,
      calendly: result.calendlyData,
      message: 'Meeting creado exitosamente y enviada invitación al cliente',
    });
  } catch (error) {
    logger.error('Error en createMeetingWithCalendly:', error);

    // Devolver error más específico si es por falta de email
    if (error.message.includes('email')) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    next(error);
  }
}

module.exports = {
  getMeeting,
  updateMeeting,
  getScheduledMeetings,
  getMyMeetings,
  getMeetingStats,
  deleteMeeting,
  createMeetingWithCalendly,
};
