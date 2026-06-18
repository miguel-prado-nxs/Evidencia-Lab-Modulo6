/**
 * Establishment Meeting Service
 * Servicio para manejar meetings de establecimientos
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../config/logger');

/**
 * Obtener meeting de un establecimiento para un partner
 */
async function getMeetingByEstablishment(establishmentId, partnerId) {
  try {
    const meeting = await prisma.establishmentMeeting.findUnique({
      where: {
        establishmentId_partnerId: {
          establishmentId,
          partnerId,
        },
      },
    });

    return meeting;
  } catch (error) {
    logger.error('Error en getMeetingByEstablishment:', error);
    throw error;
  }
}

/**
 * Crear o actualizar meeting de un establecimiento
 */
async function upsertMeeting(establishmentId, partnerId, data) {
  try {
    const meeting = await prisma.establishmentMeeting.upsert({
      where: {
        establishmentId_partnerId: {
          establishmentId,
          partnerId,
        },
      },
      create: {
        establishmentId,
        partnerId,
        meetingScheduled: data.meetingScheduled ?? false,
        meetingDate: data.meetingDate ? new Date(data.meetingDate) : null,
        meetingLink: data.meetingLink || null,
        notes: data.notes || null,
      },
      update: {
        meetingScheduled: data.meetingScheduled ?? false,
        meetingDate: data.meetingDate ? new Date(data.meetingDate) : null,
        meetingLink: data.meetingLink || null,
        notes: data.notes !== undefined ? data.notes : undefined,
      },
    });

    return meeting;
  } catch (error) {
    logger.error('Error en upsertMeeting:', error);
    throw error;
  }
}

/**
 * Obtener meetings programados en un rango de fechas para un partner
 */
async function getScheduledMeetings(partnerId, startDate, endDate) {
  try {
    const meetings = await prisma.establishmentMeeting.findMany({
      where: {
        partnerId,
        meetingScheduled: true,
        meetingDate: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: {
        meetingDate: 'asc',
      },
    });

    return meetings;
  } catch (error) {
    logger.error('Error en getScheduledMeetings:', error);
    throw error;
  }
}

/**
 * Obtener todos los meetings de un partner
 */
async function getMeetingsByPartner(partnerId, onlyScheduled = false) {
  try {
    const where = { partnerId };
    if (onlyScheduled) {
      where.meetingScheduled = true;
    }

    const meetings = await prisma.establishmentMeeting.findMany({
      where,
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return meetings;
  } catch (error) {
    logger.error('Error en getMeetingsByPartner:', error);
    throw error;
  }
}

/**
 * Eliminar meeting
 */
async function deleteMeeting(establishmentId, partnerId) {
  try {
    await prisma.establishmentMeeting.delete({
      where: {
        establishmentId_partnerId: {
          establishmentId,
          partnerId,
        },
      },
    });

    return true;
  } catch (error) {
    if (error.code === 'P2025') {
      // Record not found
      return false;
    }
    logger.error('Error en deleteMeeting:', error);
    throw error;
  }
}

/**
 * Obtener estadísticas de meetings para un partner
 */
async function getMeetingStats(partnerId) {
  try {
    const [total, scheduled, upcoming] = await Promise.all([
      prisma.establishmentMeeting.count({
        where: { partnerId },
      }),
      prisma.establishmentMeeting.count({
        where: { partnerId, meetingScheduled: true },
      }),
      prisma.establishmentMeeting.count({
        where: {
          partnerId,
          meetingScheduled: true,
          meetingDate: { gte: new Date() },
        },
      }),
    ]);

    return {
      total,
      scheduled,
      upcoming,
      past: scheduled - upcoming,
    };
  } catch (error) {
    logger.error('Error en getMeetingStats:', error);
    throw error;
  }
}

/**
 * Crear meeting con Calendly y guardar en BD
 * Usa el endpoint /invitees para crear el evento directamente
 */
async function createMeetingWithCalendly(establishmentId, partnerId, meetingData) {
  try {
    // Verificar que el establecimiento tenga enrichment con email
    const enrichment = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId },
      select: {
        decisionMakerEmail: true,
        decisionMakerName: true,
        decisionMakerPhone: true,
      },
    });

    if (!enrichment || !enrichment.decisionMakerEmail) {
      throw new Error('El establecimiento debe tener un email de contacto registrado');
    }

    const { startTime, endTime, notes } = meetingData;

    // Token de Calendly
    const calendlyToken =
      process.env.CALENDLY_API_TOKEN ||
      'eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0IiwidHlwIjoiUEFUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJodHRwczovL2F1dGguY2FsZW5kbHkuY29tIiwiaWF0IjoxNzY0OTY5MDkyLCJqdGkiOiJiZTZhNGUwZi1iYjk5LTQ1ZTAtODVjYS01NzJmMWMxZGVlNTkiLCJ1c2VyX3V1aWQiOiJjNmIyNTAwMC00ZTYyLTRiYjAtYWU1OS1lY2U4ZDgxZTljOTIifQ.X0RKR9VhbF_sFUgB5Qb1Icok5xJvsmcRlPmBRbJseRSAYdCS0-mWRYjXcVbmw4KMS6nJQNiNuQmy8GfiMUhsYQ';

    // 1. Crear invitee en Calendly (esto crea el evento y envía email)
    const calendlyPayload = {
      event_type: 'https://api.calendly.com/event_types/f68abb7b-2edf-40a9-b966-3b00da3152f9',
      start_time: startTime,
      end_time: endTime,
      invitee: {
        email: enrichment.decisionMakerEmail,
        name: enrichment.decisionMakerName || 'Cliente',
        timezone: 'America/Mazatlan',
      },
      location: {
        kind: 'zoom_conference',
      },
      questions_and_answers: [
        {
          question: 'Please share anything that will help prepare for our meeting.',
          answer: notes || 'Reunión programada desde EasyOrder',
          position: 0,
        },
      ],
    };

    logger.info('Creando invitee en Calendly:', {
      email: enrichment.decisionMakerEmail,
      name: enrichment.decisionMakerName,
      startTime,
    });

    const createResponse = await fetch('https://api.calendly.com/invitees', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${calendlyToken}`,
      },
      body: JSON.stringify(calendlyPayload),
    });

    if (!createResponse.ok) {
      const errorData = await createResponse.json().catch(() => ({}));
      logger.error('Error de Calendly API:', errorData);
      throw new Error(
        `Error al crear meeting en Calendly: ${createResponse.status} - ${JSON.stringify(errorData)}`
      );
    }

    const calendlyData = await createResponse.json();
    logger.info('Invitee creado en Calendly:', JSON.stringify(calendlyData, null, 2));

    // 2. Obtener el scheduled_event URI de la respuesta
    // La respuesta del POST /invitees devuelve el URI del evento creado
    const scheduledEventUri =
      calendlyData.resource?.scheduled_event || calendlyData.resource?.event;

    if (!scheduledEventUri) {
      logger.warn('No se encontró URI del evento en la respuesta de Calendly');
    }

    // 3. Obtener detalles del evento para conseguir el link de Zoom
    let zoomLink = null;
    let eventUri = scheduledEventUri;

    if (scheduledEventUri) {
      // Esperar un momento para que Calendly procese el evento
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const eventResponse = await fetch(scheduledEventUri, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${calendlyToken}`,
          },
        });

        if (eventResponse.ok) {
          const eventData = await eventResponse.json();
          logger.info('Detalles del evento Calendly:', JSON.stringify(eventData, null, 2));

          // Extraer link de Zoom
          if (eventData.resource?.location?.join_url) {
            zoomLink = eventData.resource.location.join_url;
            logger.info('Link de Zoom encontrado:', zoomLink);
          }

          eventUri = eventData.resource?.uri || scheduledEventUri;
        }
      } catch (eventError) {
        logger.warn('No se pudieron obtener detalles del evento:', eventError.message);
      }
    }

    // 4. Guardar en BD
    const meeting = await prisma.establishmentMeeting.upsert({
      where: {
        establishmentId_partnerId: {
          establishmentId,
          partnerId,
        },
      },
      create: {
        establishmentId,
        partnerId,
        meetingScheduled: true,
        meetingDate: new Date(startTime),
        meetingLink: zoomLink || 'Pendiente - revisar en Calendly',
        notes: notes || `Demo con ${enrichment.decisionMakerName || 'cliente'}`,
        calendlyEventUri: eventUri,
      },
      update: {
        meetingScheduled: true,
        meetingDate: new Date(startTime),
        meetingLink: zoomLink || 'Pendiente - revisar en Calendly',
        notes: notes || `Demo con ${enrichment.decisionMakerName || 'cliente'}`,
        calendlyEventUri: eventUri,
      },
    });

    logger.info(`Meeting guardado en BD - ID: ${meeting.id}, Link: ${meeting.meetingLink}`);

    return {
      meeting,
      calendlyData,
      zoomLink,
      message:
        'Meeting creado exitosamente. El cliente recibirá un email de Calendly con la invitación.',
    };
  } catch (error) {
    logger.error('Error en createMeetingWithCalendly:', error);
    throw error;
  }
}

module.exports = {
  getMeetingByEstablishment,
  upsertMeeting,
  getScheduledMeetings,
  getMeetingsByPartner,
  deleteMeeting,
  getMeetingStats,
  createMeetingWithCalendly,
};
