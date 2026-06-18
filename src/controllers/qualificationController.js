/**
 * Qualification Controller
 * Controlador para endpoints del Agente de Calificación (BANT)
 *
 * Recibe callbacks desde agentes-crm-sdk para:
 * - Reportar resultados de llamadas de calificación
 * - Actualizar nivel de PROSPECT a LEAD cuando se completa BANT
 * - Registrar información de calificación (intent, fear, pain, desire)
 */

const { PrismaClient } = require('@prisma/client');
const logger = require('../config/logger');
const { emitLevelChanged, emitEnrichmentUpdated } = require('../config/sseEvents');
const { enqueueSync } = require('../services/twenty/twentySyncService');

const prisma = new PrismaClient();

/**
 * POST /api/v1/qualification/call-result
 * Recibe resultado de llamada de calificación desde agentes-crm-sdk.
 *
 * @route POST /api/v1/qualification/call-result
 * @access Privado (requiere API Key)
 */
async function handleCallResult(req, res, next) {
  try {
    const body = req.body;

    // El SDK envía snake_case, pero también aceptamos camelCase
    // Normalizar todos los campos
    const establishmentId = body.establishmentId || body.establishment_id;
    const callLeadId = body.callLeadId || body.call_lead_id;
    const twilioCallSid = body.twilioCallSid || body.twilio_call_sid;

    // A/B Testing Context
    const abTestContactId = body.abTestContactId || body.ab_test_contact_id;

    // Datos del prospecto
    const fullName = body.fullName || body.full_name;
    const phone = body.phone;
    const email = body.email;

    // Estado de la llamada
    const callStatus = body.callStatus || body.call_status || 'completed';

    // Resultados de la llamada
    const callSummary = body.callSummary || body.call_summary;
    const callTranscript = body.callTranscript || body.call_transcript;
    const callDurationSeconds = body.callDurationSeconds || body.call_duration_seconds;

    // Calificación
    const qualificationCompleted =
      body.qualificationCompleted || body.qualification_completed || false;
    const qualificationScore = body.qualificationScore || body.qualification_score;
    const intentScore = body.intentScore || body.intent_score;
    const qualificationDetails = body.qualificationDetails || body.qualification_details;

    // BANT específicos (intent, fear, pain, desire)
    const intent = body.intent;
    const fear = body.fear;
    const pain = body.pain;
    const desire = body.desire;

    // Seguimiento
    const nextAction = body.nextAction || body.next_action;
    const nextActionDate = body.nextActionDate || body.next_action_date;

    // Demo
    const demoScheduled = body.demoScheduled || body.demo_scheduled || false;
    const demoDate = body.demoDate || body.demo_date || body.demo_datetime;
    const scheduledAt = body.scheduledAt || body.scheduled_at || demoDate; // Fecha de demo agendada
    const bookingMethod = body.bookingMethod || body.booking_method || 'calendly';
    const meetingLink = body.meetingLink || body.meeting_link; // URL de Zoom
    const calendlyEventId = body.calendlyEventId || body.calendly_event_id;
    const calendlyEventUri = body.calendlyEventUri || body.calendly_event_uri;

    // Nombre del negocio (para referencia)
    const businessName = body.businessName || body.business_name;

    // Asignación
    const userId = body.userId || body.user_id;

    console.log('=== QUALIFICATION RESULT RECIBIDO ===');
    console.log('Establishment ID:', establishmentId);
    console.log('Call Status:', callStatus);
    console.log('Qualification Completed:', qualificationCompleted);
    console.log('Qualification Score:', qualificationScore);
    console.log('Intent Score:', intentScore);
    console.log('Call Summary:', callSummary ? callSummary.substring(0, 100) + '...' : 'N/A');
    console.log('Call Duration:', callDurationSeconds, 's');
    console.log('Business Name:', businessName);
    console.log('Demo Scheduled:', demoScheduled);
    console.log('User ID:', userId);
    console.log('=====================================');

    // Extraer pain y desire de qualification_details si no vienen directamente
    let painValue = pain;
    let desireValue = desire;
    let intentValue = intent;

    if (qualificationDetails) {
      // pain_points → pain (como texto)
      if (!painValue && qualificationDetails.pain_points) {
        painValue = Array.isArray(qualificationDetails.pain_points)
          ? qualificationDetails.pain_points.join(', ')
          : qualificationDetails.pain_points;
      }
      // interests → desire (como texto)
      if (!desireValue && qualificationDetails.interests) {
        desireValue = Array.isArray(qualificationDetails.interests)
          ? qualificationDetails.interests.join(', ')
          : qualificationDetails.interests;
      }
      // current_situation → intent (contexto de interés)
      if (!intentValue && qualificationDetails.current_situation) {
        intentValue = qualificationDetails.current_situation;
      }
    }

    // Validación básica
    if (!establishmentId && !callLeadId) {
      return res.status(400).json({
        success: false,
        error: 'establishmentId o callLeadId es requerido',
      });
    }

    // =========================================
    // 1. GUARDAR/ACTUALIZAR CALL LEAD
    // =========================================

    let callLead;
    const callLeadData = {
      callStatus,
      callSummary,
      callTranscript,
      callDurationSeconds: callDurationSeconds ? parseInt(callDurationSeconds) : null,
      qualificationScore,
      intentScore: intentScore ? parseInt(intentScore) : null,
      qualificationDetails,
      intent: intentValue,
      fear,
      pain: painValue,
      desire: desireValue,
      nextAction,
      nextActionDate: nextActionDate ? new Date(nextActionDate) : null,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null, // Fecha de demo agendada
      bookingMethod,
      twilioCallSid,
      calledAt: new Date(),
      updatedAt: new Date(),
    };

    // Usar upsert basándose en establishmentId + twilioCallSid para evitar duplicados
    // y permitir que el primer callback cree el registro y los siguientes lo actualicen
    if (establishmentId && twilioCallSid) {
      // Buscar si ya existe un CallLead para esta llamada específica
      const existingCallLead = await prisma.callLead.findFirst({
        where: {
          establishmentId: establishmentId,
          twilioCallSid: twilioCallSid,
        },
      });

      if (existingCallLead) {
        // Actualizar el registro existente
        callLead = await prisma.callLead.update({
          where: { id: existingCallLead.id },
          data: callLeadData,
        });
        logger.info(`[Qualification] CallLead actualizado: ${callLead.id}`);
      } else {
        // Crear nuevo registro
        callLead = await prisma.callLead.create({
          data: {
            ...callLeadData,
            fullName: fullName || 'Prospecto',
            phone: phone || '',
            email,
            establishmentId,
            partnerId: userId || null,
            source: 'sales_qualification',
          },
        });
        logger.info(`[Qualification] CallLead creado: ${callLead.id}`);
      }
    } else if (establishmentId) {
      // Si no hay twilioCallSid, buscar CallLead existente por establishmentId y actualizar
      // Esto evita crear duplicados cuando schedule_calendly_demo envía PATCH sin SID
      const existingCallLeadByEstablishment = await prisma.callLead.findFirst({
        where: { establishmentId },
        orderBy: { createdAt: 'desc' }, // Usar el más reciente
      });

      if (existingCallLeadByEstablishment) {
        // Actualizar el registro existente
        callLead = await prisma.callLead.update({
          where: { id: existingCallLeadByEstablishment.id },
          data: callLeadData,
        });
        logger.info(`[Qualification] CallLead actualizado (por establishmentId): ${callLead.id}`);
      } else {
        // Crear nuevo registro solo si no existe ninguno
        callLead = await prisma.callLead.create({
          data: {
            ...callLeadData,
            fullName: fullName || 'Prospecto',
            phone: phone || '',
            email,
            establishmentId,
            partnerId: userId || null,
            source: 'sales_qualification',
          },
        });
        logger.info(`[Qualification] CallLead creado (sin SID): ${callLead.id}`);
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'establishmentId es requerido para crear CallLead',
      });
    }

    // =========================================
    // 2. ACTUALIZAR ESTABLISHMENT ENRICHMENT
    // =========================================

    if (establishmentId) {
      const existingEnrichment = await prisma.establishmentEnrichment.findUnique({
        where: { establishmentId },
      });

      if (existingEnrichment) {
        const enrichmentUpdate = {
          updatedAt: new Date(),
        };

        // Si la calificación se completó, actualizar nivel a LEAD
        if (qualificationCompleted) {
          enrichmentUpdate.level = 'LEAD';
          logger.info(`[Qualification] Promoviendo ${establishmentId} a LEAD`);

          // =========================================
          // ACTUALIZAR LEAD_PROSPECTS A CONVERTED
          // =========================================
          try {
            const leadProspect = await prisma.leadProspect.findFirst({
              where: { establishmentId },
            });

            if (leadProspect && leadProspect.status === 'ASSIGNED') {
              await prisma.leadProspect.update({
                where: { id: leadProspect.id },
                data: {
                  status: 'CONVERTED',
                  convertedAt: new Date(),
                },
              });
              logger.info(
                `[Qualification] LeadProspect actualizado a CONVERTED: ${leadProspect.id}`
              );
            }
          } catch (prospectError) {
            logger.error(`[Qualification] Error actualizando leadProspect:`, prospectError.message);
            // No fallar el endpoint por error en leadProspect
          }

          // =========================================
          // CREAR REGISTRO EN TABLA LEADS (global)
          // =========================================
          const leadPartnerId = userId || existingEnrichment.enrichedBy;

          if (leadPartnerId) {
            try {
              // Verificar si ya existe un Lead para este establishment
              const existingLead = await prisma.lead.findFirst({
                where: {
                  partnerId: leadPartnerId,
                  notes: { contains: `ID Establecimiento: ${establishmentId}` },
                },
              });

              if (!existingLead) {
                // Crear nuevo Lead
                const newLead = await prisma.lead.create({
                  data: {
                    partnerId: leadPartnerId,
                    businessName:
                      businessName || existingEnrichment.decisionMakerName || 'Negocio sin nombre',
                    contactName: fullName || existingEnrichment.decisionMakerName || 'Sin nombre',
                    email: email || existingEnrichment.decisionMakerEmail || '',
                    phone: phone || existingEnrichment.decisionMakerPhone || '',
                    qualityScore: intentScore || null,
                    status: demoScheduled ? 'QUALIFIED' : 'NEW',
                    qualifiedAt: qualificationCompleted ? new Date() : null,
                    contactedAt: new Date(),
                    notes: `Convertido desde calificación por agente. ID Establecimiento: ${establishmentId}. Score: ${qualificationScore || 'N/A'}`,
                    interests: desireValue ? [desireValue] : ['POS'],
                  },
                });
                logger.info(`[Qualification] Lead creado en tabla global: ${newLead.id}`);
              } else {
                // Actualizar Lead existente
                await prisma.lead.update({
                  where: { id: existingLead.id },
                  data: {
                    qualityScore: intentScore || existingLead.qualityScore,
                    status: demoScheduled ? 'QUALIFIED' : existingLead.status,
                    qualifiedAt: qualificationCompleted ? new Date() : existingLead.qualifiedAt,
                    updatedAt: new Date(),
                  },
                });
                logger.info(`[Qualification] Lead existente actualizado: ${existingLead.id}`);
              }
            } catch (leadError) {
              logger.error(`[Qualification] Error creando/actualizando Lead:`, leadError.message);
              // No fallar el endpoint por error en Lead
            }
          } else {
            logger.warn(`[Qualification] No se puede crear Lead: falta partnerId`);
          }
        }

        // Campos de llamada (para tracking de estado)
        const enrichmentStatus = body.enrichmentStatus || body.enrichment_status;
        const callAttemptsValue = body.callAttempts || body.call_attempts;

        // Guardar datos de calificación (usando valores extraídos de qualification_details)
        if (intentValue) enrichmentUpdate.intent = intentValue;
        if (fear) enrichmentUpdate.fear = fear;
        if (painValue) enrichmentUpdate.pain = painValue;
        if (desireValue) enrichmentUpdate.desire = desireValue;

        // Campos de llamada en establishment_enrichments
        if (callStatus) enrichmentUpdate.callStatus = callStatus;
        if (enrichmentStatus) enrichmentUpdate.enrichmentStatus = enrichmentStatus;
        if (callDurationSeconds !== undefined)
          enrichmentUpdate.callDurationSeconds = parseInt(callDurationSeconds);
        if (callAttemptsValue !== undefined)
          enrichmentUpdate.callAttempts = parseInt(callAttemptsValue);

        // Nota: qualificationScore NO existe en EstablishmentEnrichment, está en CallLead
        if (callSummary) enrichmentUpdate.callSummary = callSummary;

        // Guardar notas en clientNotes (notes no existe en EstablishmentEnrichment)
        if (callSummary) {
          const existingNotes = existingEnrichment.clientNotes || '';
          const timestamp = new Date().toLocaleString('es-MX', { timeZone: 'America/Mazatlan' });
          enrichmentUpdate.clientNotes = existingNotes
            ? `${existingNotes}\n\n[Calificación ${timestamp}]\n${callSummary}`
            : `[Calificación ${timestamp}]\n${callSummary}`;
        }

        await prisma.establishmentEnrichment.update({
          where: { establishmentId },
          data: enrichmentUpdate,
        });

        logger.info(`[Qualification] EstablishmentEnrichment actualizado: ${establishmentId}`);

        // Emitir evento SSE si el nivel cambió
        if (qualificationCompleted && existingEnrichment.level !== 'LEAD') {
          const enrichedBy = userId || existingEnrichment.enrichedBy;
          if (enrichedBy) {
            emitLevelChanged({
              partnerId: enrichedBy,
              establishmentId,
              previousLevel: existingEnrichment.level,
              newLevel: 'LEAD',
              enrichment: {
                id: existingEnrichment.id,
                level: 'LEAD',
                decisionMakerName: existingEnrichment.decisionMakerName,
                updatedAt: new Date(),
              },
            });

            // Encolar sincronizacion con Twenty CRM (non-blocking)
            enqueueSync({
              establishmentId,
              partnerId: enrichedBy,
              reason: 'QUALIFICATION_TO_LEAD',
            }).catch((err) => {
              logger.warn('[Qualification] Error encolando sync (no critico)', {
                error: err.message,
              });
            });
          }
        }
      }

      // =========================================
      // 3. GUARDAR MEETING SI SE AGENDO DEMO
      // =========================================

      // Usar enrichedBy como fallback si no viene userId del SDK
      const meetingUserId = userId || (existingEnrichment ? existingEnrichment.enrichedBy : null);

      console.log('=== MEETING DATA ===');
      console.log('Demo Scheduled:', demoScheduled);
      console.log('Demo Date:', demoDate);
      console.log('User ID (from payload):', userId);
      console.log('Meeting User ID (with fallback):', meetingUserId);
      console.log('Meeting Link:', meetingLink);
      console.log('Calendly Event URI:', calendlyEventUri);
      console.log('Calendly Event ID:', calendlyEventId);
      console.log('====================');

      if (demoScheduled && demoDate && meetingUserId) {
        try {
          const meetingData = {
            meetingScheduled: true,
            meetingDate: new Date(demoDate),
            meetingLink: meetingLink || null,
            calendlyEventUri:
              calendlyEventUri ||
              (calendlyEventId
                ? `https://api.calendly.com/scheduled_events/${calendlyEventId}`
                : null),
            notes: `Demo agendada por agente de calificación (${bookingMethod})`,
            updatedAt: new Date(),
          };

          await prisma.establishmentMeeting.upsert({
            where: {
              establishmentId_partnerId: {
                establishmentId,
                partnerId: meetingUserId,
              },
            },
            update: meetingData,
            create: {
              establishmentId,
              partnerId: meetingUserId,
              ...meetingData,
            },
          });
          logger.info(
            `[Qualification] Demo guardada en establishment_meetings para ${establishmentId}: ${demoDate}`
          );
        } catch (meetingError) {
          logger.error(`[Qualification] Error guardando meeting:`, meetingError.message);
          console.error(meetingError);
        }
      } else {
        console.log(
          `[Qualification] No se guardó meeting - demoScheduled: ${demoScheduled}, demoDate: ${demoDate}, userId: ${meetingUserId}`
        );
      }
    }

    // =========================================
    // 5. ACTUALIZAR A/B TEST CONTACT (si aplica)
    // =========================================
    if (abTestContactId) {
      try {
        const callResult = {
          success: true,
          status: callStatus,
          twilioCallSid,
          callSummary,
          callDurationSeconds,
          qualificationScore,
          intentScore,
          qualificationCompleted,
          demoScheduled,
          completedAt: new Date().toISOString(),
        };

        await prisma.abTestContact.update({
          where: { id: abTestContactId },
          data: {
            status: 'COMPLETED',
            result: JSON.stringify(callResult),
            completedAt: new Date(),
          },
        });

        logger.info(`[Qualification] A/B Test Contact actualizado: ${abTestContactId} → COMPLETED`);
      } catch (abTestError) {
        logger.error(
          `[Qualification] Error actualizando abTestContact ${abTestContactId}:`,
          abTestError.message
        );
        // No fallar todo el flujo si hay error actualizando A/B test
      }
    }

    res.json({
      success: true,
      message: qualificationCompleted
        ? 'Calificación completada - Prospecto promovido a Lead'
        : 'Resultado de calificación guardado',
      data: {
        callLeadId: callLead.id,
        establishmentId,
        qualificationScore,
        demoScheduled,
      },
    });
  } catch (error) {
    logger.error('[Qualification] Error procesando resultado:', error.message);
    next(error);
  }
}

/**
 * PUT /api/v1/qualification/call-record/:id
 * Actualiza un registro de llamada existente en establishment_enrichments
 *
 * @route PUT /api/v1/qualification/call-record/:id
 * @access Privado (requiere X-Enrichment-Agent-Key)
 */
async function updateCallRecord(req, res, next) {
  try {
    const { id } = req.params;
    const body = req.body;

    logger.info(`[Qualification] Actualizando call record: ${id}`);

    // Normalizar campos
    const callStatus = body.callStatus || body.call_status;
    const enrichmentStatus = body.enrichmentStatus || body.enrichment_status;
    const callDurationSeconds = body.callDurationSeconds || body.call_duration_seconds;
    const callSummary = body.callSummary || body.call_summary;
    const callAttemptsValue = body.callAttempts || body.call_attempts;

    // BANT Scores
    const needScore = body.needScore || body.need_score;
    const authorityScore = body.authorityScore || body.authority_score;
    const budgetScore = body.budgetScore || body.budget_score;
    const timelineScore = body.timelineScore || body.timeline_score;
    const overallScore = body.overallScore || body.overall_score;

    // FPDI
    const intent = body.intent;
    const fear = body.fear;
    const pain = body.pain;
    const desire = body.desire;

    // Qualification metadata
    const qualificationNotes = body.qualificationNotes || body.qualification_notes;
    const qualificationCompleted = body.qualificationCompleted || body.qualification_completed;
    const confidenceLevel = body.confidenceLevel || body.confidence_level;

    // Demo info
    const demoScheduled = body.demoScheduled || body.demo_scheduled;
    const demoDatetime = body.demoDatetime || body.demo_datetime;
    const calendlyEventUri = body.calendlyEventUri || body.calendly_event_uri;

    // Decision maker info
    const decisionMaker = body.decisionMaker || body.decision_maker;

    // Buscar el enrichment por ID (puede ser el enrichment ID o establishment ID)
    let enrichment = await prisma.establishmentEnrichment.findUnique({
      where: { id },
    });

    if (!enrichment) {
      // Intentar buscar por establishment_id
      enrichment = await prisma.establishmentEnrichment.findUnique({
        where: { establishmentId: id },
      });
    }

    if (!enrichment) {
      return res.status(404).json({
        success: false,
        error: `Call record no encontrado: ${id}`,
      });
    }

    // Preparar datos de actualización
    const updateData = {};

    // Campos de llamada
    if (callStatus) updateData.callStatus = callStatus;
    if (enrichmentStatus) updateData.enrichmentStatus = enrichmentStatus;
    if (callDurationSeconds !== undefined)
      updateData.callDurationSeconds = parseInt(callDurationSeconds);
    if (callSummary) updateData.callSummary = callSummary;
    if (callAttemptsValue !== undefined) updateData.callAttempts = parseInt(callAttemptsValue);

    // BANT Scores
    if (needScore !== undefined) updateData.needScore = parseInt(needScore);
    if (authorityScore !== undefined) updateData.authorityScore = parseInt(authorityScore);
    if (budgetScore !== undefined) updateData.budgetScore = parseInt(budgetScore);
    if (timelineScore !== undefined) updateData.timelineScore = parseInt(timelineScore);
    if (overallScore !== undefined) updateData.overallScore = parseInt(overallScore);

    // FPDI
    if (intent) updateData.intent = intent;
    if (fear) updateData.fear = fear;
    if (pain) updateData.pain = pain;
    if (desire) updateData.desire = desire;

    // Qualification metadata
    if (qualificationNotes) updateData.qualificationNotes = qualificationNotes;
    if (qualificationCompleted !== undefined)
      updateData.qualificationCompleted = qualificationCompleted;
    if (confidenceLevel) updateData.confidenceLevel = confidenceLevel;

    // Decision maker info
    if (decisionMaker) {
      if (decisionMaker.name) updateData.decisionMakerName = decisionMaker.name;
      if (decisionMaker.position) updateData.decisionMakerPosition = decisionMaker.position;
      if (decisionMaker.phone) updateData.decisionMakerPhone = decisionMaker.phone;
      if (decisionMaker.whatsapp) updateData.decisionMakerWhatsApp = decisionMaker.whatsapp;
      if (decisionMaker.email) updateData.decisionMakerEmail = decisionMaker.email;
    }

    // Actualizar enrichment
    const updatedEnrichment = await prisma.establishmentEnrichment.update({
      where: { id: enrichment.id },
      data: updateData,
    });

    logger.info(
      `[Qualification] Call record actualizado: ${enrichment.id} (establishment: ${enrichment.establishmentId})`
    );

    // Si se agendó demo, crear/actualizar meeting
    if (demoScheduled && demoDatetime && enrichment.enrichedBy) {
      try {
        await prisma.establishmentMeeting.upsert({
          where: {
            establishmentId_partnerId: {
              establishmentId: enrichment.establishmentId,
              partnerId: enrichment.enrichedBy,
            },
          },
          create: {
            establishmentId: enrichment.establishmentId,
            partnerId: enrichment.enrichedBy,
            meetingScheduled: true,
            meetingDate: new Date(demoDatetime),
            calendlyEventUri: calendlyEventUri || null,
            notes: 'Demo agendada por agente de calificación',
          },
          update: {
            meetingScheduled: true,
            meetingDate: new Date(demoDatetime),
            calendlyEventUri: calendlyEventUri || null,
            updatedAt: new Date(),
          },
        });
        logger.info(`[Qualification] Meeting actualizado para ${enrichment.establishmentId}`);
      } catch (meetingError) {
        logger.error(`[Qualification] Error actualizando meeting:`, meetingError.message);
      }
    }

    res.json({
      success: true,
      message: 'Call record actualizado exitosamente',
      data: {
        id: updatedEnrichment.id,
        establishmentId: updatedEnrichment.establishmentId,
        callStatus: updatedEnrichment.callStatus,
        enrichmentStatus: updatedEnrichment.enrichmentStatus,
      },
    });
  } catch (error) {
    logger.error('[Qualification] Error actualizando call record:', error.message);
    next(error);
  }
}

/**
 * GET /api/v1/qualification/stats
 * Obtiene estadísticas de calificación para dashboard.
 *
 * @route GET /api/v1/qualification/stats
 * @access Privado (requiere API Key)
 */
async function getStats(req, res, next) {
  try {
    // Contar por score de calificación
    const scoreStats = await prisma.callLead.groupBy({
      by: ['qualificationScore'],
      _count: { qualificationScore: true },
      where: {
        qualificationScore: { not: null },
      },
    });

    // Contar por status
    const statusStats = await prisma.callLead.groupBy({
      by: ['callStatus'],
      _count: { callStatus: true },
    });

    // Total de llamadas
    const totalCalls = await prisma.callLead.count();

    // Llamadas completadas
    const completedCalls = await prisma.callLead.count({
      where: { callStatus: 'completed' },
    });

    // Demos agendadas
    const demosScheduled = await prisma.callLead.count({
      where: { bookingMethod: { not: null } },
    });

    res.json({
      success: true,
      data: {
        totalCalls,
        completedCalls,
        scoreDistribution: scoreStats,
        statusDistribution: statusStats,
        demosScheduled,
        conversionRate: totalCalls > 0 ? ((demosScheduled / totalCalls) * 100).toFixed(1) : 0,
      },
    });
  } catch (error) {
    logger.error('[Qualification] Error obteniendo stats:', error.message);
    next(error);
  }
}

module.exports = {
  handleCallResult,
  updateCallRecord,
  getStats,
};
