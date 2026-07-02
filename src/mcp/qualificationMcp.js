const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const svc = require('../services/funnelWebhookService');
const logger = require('../config/logger');
const config = require('../config/env');

// Devuelve null si el valor es un placeholder ElevenLabs sin reemplazar (ej: "{{callId}}")
// o si el valor es igual al nombre del parámetro (indicador de error del agente)
const sanitizeVar = (value, paramName) => {
  if (typeof value !== 'string') return value || null;
  const v = value.trim();

  // Descarta placeholders sin resolver
  if (v.includes('{{') || v.includes('}}')) return null;

  // Descarta si el valor es igual al nombre del parámetro (ej: agente mandó "establishment_id" como valor)
  if (paramName && v.toLowerCase() === paramName.toLowerCase()) return null;

  return v || null;
};

// Normaliza enums: acepta valores en español y los mapea a inglés
const normalizeEnum = (value, options = {}) => {
  if (!value || typeof value !== 'string') return value;
  const normalized = value.trim().toUpperCase();
  const spanishToEnglish = {
    ALTO: 'HIGH',
    HIGH: 'HIGH',
    MUY_ALTO: 'HIGH',
    URGENTE: 'HIGH',
    URGENCIA: 'HIGH',
    INMEDIATO: 'HIGH',
    AHORITA: 'HIGH',
    CUANTO_ANTES: 'HIGH',
    MEDIO: 'MEDIUM',
    MEDIA: 'MEDIUM',
    MEDIUM: 'MEDIUM',
    MODERADO: 'MEDIUM',
    MEDIANO: 'MEDIUM',
    BAJO: 'LOW',
    LOW: 'LOW',
    MUY_BAJO: 'LOW',
    NO_URGENTE: 'LOW',
    PUEDE_ESPERAR: 'LOW',
    SIN_PRISA: 'LOW',
  };

  // Primero intenta mapeo exacto
  if (spanishToEnglish[normalized]) return spanishToEnglish[normalized];

  // Si no encuentra mapeo exacto, intenta inferir por palabras clave
  // IMPORTANTE: Detectar negaciones PRIMERO para evitar falsos positivos
  if (
    normalized.includes('NO URGENTE') ||
    normalized.includes('NO ES URGENTE') ||
    normalized.includes('PUEDE ESPERAR') ||
    normalized.includes('SIN PRISA') ||
    normalized.includes('CUANDO PUEDAN') ||
    normalized.includes('DESPUÉS') ||
    normalized.includes('ESPERAR')
  ) {
    return 'LOW';
  }

  if (
    normalized.includes('ESTE MES') ||
    normalized.includes('SEMANA') ||
    normalized.includes('AHORA') ||
    normalized.includes('RÁPIDO') ||
    normalized.includes('URGENTE') ||
    normalized.includes('INMEDIATO') ||
    normalized.includes('CUANTO ANTES') ||
    normalized.includes('PRONTO')
  ) {
    return 'HIGH';
  }

  // Default a MEDIUM si está en el medio
  return 'MEDIUM';
};

function createQualificationServer() {
  const server = new McpServer({ name: 'funnel-qualification', version: '1.0.0' });

  server.tool(
    'save_qualification_data',
    'Guarda información de calificación con datos operacionales y de marketing. Llamar después de explorar cada área.',
    {
      conversation_id: z
        .string()
        .describe('ID conversación (valor conversation_id de la sección DATOS de tu prompt)'),
      establishment_id: z
        .string()
        .describe('ID establecimiento (valor establishment_id de la sección DATOS de tu prompt)'),
      daily_orders_range: z.string().optional().describe('Rango preciso de pedidos diarios'),
      average_ticket: z.coerce.number().optional().describe('Ticket promedio en pesos'),
      approximate_sales: z.string().optional().describe('Ventas aproximadas mensuales'),
      employee_count: z.coerce.number().int().optional().describe('Empleados en operación'),
      pos_count: z.coerce.number().int().optional().describe('Cajas/puntos de venta'),
      branch_count: z.coerce.number().int().optional().describe('Sucursales'),
      disorder_level: z
        .string()
        .optional()
        .describe(
          'Nivel de desorden operacional: HIGH (muy desordenado), MEDIUM (moderado), LOW (bien organizado)'
        ),
      duplicate_processes: z.string().optional().describe('Procesos duplicados identificados'),
      current_tools: z.string().optional().describe('Herramientas actuales que usa'),
      time_impact: z.string().optional().describe('Impacto en tiempo'),
      money_impact: z.string().optional().describe('Impacto en dinero'),
      control_impact: z.string().optional().describe('Impacto en control'),
      problem_priority: z
        .string()
        .optional()
        .describe(
          'Prioridad del problema: HIGH (urgente), MEDIUM (importante), LOW (menor), NONE (sin problema)'
        ),
      resolution_intent: z
        .string()
        .optional()
        .describe(
          'Intención de resolver: HIGH (quiere resolverlo pronto), MEDIUM (moderada), LOW (sin urgencia)'
        ),
      decision_maker: z.string().optional().describe('Quién toma la decisión'),
      decision_process: z
        .string()
        .optional()
        .describe('Proceso de decisión (solo o con alguien más)'),
      evaluating_options: z.boolean().optional().describe('¿Evalúa otras opciones?'),
      previous_system_experience: z.string().optional().describe('Qué no funcionó antes'),
      implementation_horizon: z
        .string()
        .optional()
        .describe('Horizonte de implementación (corto/mediano/largo)'),
      qualification_notes: z.string().optional().describe('Notas generales'),
    },
    async ({
      conversation_id,
      establishment_id,
      daily_orders_range,
      average_ticket,
      approximate_sales,
      employee_count,
      pos_count,
      branch_count,
      disorder_level,
      duplicate_processes,
      current_tools,
      time_impact,
      money_impact,
      control_impact,
      problem_priority,
      resolution_intent,
      decision_maker,
      decision_process,
      evaluating_options,
      previous_system_experience,
      implementation_horizon,
      qualification_notes,
    }) => {
      try {
        // Normalizar enums: mapear valores españoles a inglés
        const result = await svc.saveQualificationResult({
          conversationId: sanitizeVar(conversation_id, 'conversation_id'),
          establishmentId: sanitizeVar(establishment_id, 'establishment_id'),
          dailyOrdersRange: daily_orders_range,
          averageTicket: average_ticket,
          approximateSales: approximate_sales,
          employeeCount: employee_count,
          posCount: pos_count,
          branchCount: branch_count,
          disorderLevel: normalizeEnum(disorder_level, ['HIGH', 'MEDIUM', 'LOW']),
          duplicateProcesses: duplicate_processes,
          currentTools: current_tools,
          timeImpact: time_impact,
          moneyImpact: money_impact,
          controlImpact: control_impact,
          problemPriority: normalizeEnum(problem_priority, ['HIGH', 'MEDIUM', 'LOW']),
          resolutionIntent: normalizeEnum(resolution_intent, ['HIGH', 'MEDIUM', 'LOW']),
          decisionMaker: decision_maker,
          decisionProcess: decision_process,
          evaluatingOptions: evaluating_options,
          previousSystemExperience: previous_system_experience,
          implementationHorizon: implementation_horizon,
          qualificationNotes: qualification_notes,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'mark_voicemail_detected',
    "Marca que se detectó un buzón de voz y registra el evento. Úsala cuando identifiques patrones de buzón: 'grave su mensaje', 'marque la tecla', menús automatizados, tonos DTMF, o falta de respuesta humana coherente en 2 turnos. Después de llamar a esta tool, ejecuta save_qualification_outcome con outcome='VOICEMAIL' y luego end_call para colgar. El único tool que cuelga la llamada es end_call.",
    {
      conversation_id: z.string(),
      establishment_id: z.string(),
      detection_reason: z
        .string()
        .describe("Por qué detectaste el buzón (ej: 'escuché: grave su mensaje después del tono')"),
      transcript_snippet: z
        .string()
        .optional()
        .describe('Fragmento del audio que confirmó que es buzón'),
    },
    async ({ conversation_id, establishment_id, detection_reason, transcript_snippet }) => {
      try {
        // Registrar en tu DB que cayó en voicemail
        const result = await svc.markVoicemail({
          conversationId: sanitizeVar(conversation_id, 'conversation_id'),
          establishmentId: sanitizeVar(establishment_id, 'establishment_id'),
          detectionReason: detection_reason,
          transcriptSnippet: transcript_snippet,
          detectedAt: new Date().toISOString(),
        });

        // NUEVO: Notificar al backend INMEDIATAMENTE por webhook
        const webhookUrl = `${config.server.apiBaseUrl || 'http://localhost:3004'}/api/v1/webhooks/elevenlabs/voicemail-detected`;
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            establishment_id,
            conversation_id,
            status: 'voicemail',
            detection_reason,
            timestamp: new Date().toISOString(),
          }),
        }).catch((err) => {
          logger.error('[mark_voicemail_detected Webhook] Error notificando backend:', {
            url: webhookUrl,
            error: err.message,
          });
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message:
                  "VOICEMAIL DETECTED. Execute save_qualification_outcome with outcome='VOICEMAIL', then end_call to hang up. DO NOT SPEAK. DO NOT WAIT.",
                ...result,
              }),
            },
          ],
        };
      } catch (err) {
        logger.error('[mark_voicemail_detected ERROR]', err);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: err.message,
                fallback: 'Call end_call system tool immediately to hang up',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'save_qualification_outcome',
    'Guarda y registra el resultado final de la conversación de Qualification en campaign_enrichments. NO cuelga la llamada: después de esta SIEMPRE debes ejecutar el System Tool end_call para colgar.',
    {
      conversation_id: z
        .string()
        .describe('ID conversación (valor conversation_id de la sección DATOS de tu prompt)'),
      establishment_id: z
        .string()
        .describe('ID establecimiento (valor establishment_id de la sección DATOS de tu prompt)'),
      outcome: z
        .enum([
          'QUALIFIED',
          'NOT_QUALIFIED',
          'FOLLOW_UP_LATER',
          'NOT_INTERESTED',
          'NO_ANSWER',
          'VOICEMAIL',
        ])
        .describe(
          'Outcome: QUALIFIED, NOT_QUALIFIED, FOLLOW_UP_LATER, NOT_INTERESTED, NO_ANSWER, VOICEMAIL'
        ),
      call_summary: z.string().describe('Resumen breve de la conversación'),
    },
    async ({ conversation_id, establishment_id, outcome, call_summary }) => {
      try {
        const result = await svc.endQualificationCall({
          conversationId: sanitizeVar(conversation_id, 'conversation_id'),
          establishmentId: sanitizeVar(establishment_id, 'establishment_id'),
          outcome,
          callSummary: call_summary,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'hang_up_call',
    'Cuelga la llamada inmediatamente. Notifica al backend para terminar la sesión en ElevenLabs.',
    {
      establishment_id: z
        .string()
        .optional()
        .describe(
          'ID del establecimiento (valor establishment_id de la sección DATOS de tu prompt)'
        ),
      conversation_id: z
        .string()
        .optional()
        .describe('ID de la conversación (valor conversation_id de la sección DATOS de tu prompt)'),
      reason: z.string().optional().describe('Razón del cierre'),
    },
    async ({ establishment_id, conversation_id, reason }) => {
      logger.info('[hang_up_call] Cierre de llamada solicitado', {
        establishment_id,
        conversation_id,
        reason,
      });

      const webhookUrl = `${config.server.apiBaseUrl || 'http://localhost:3004'}/api/v1/webhooks/elevenlabs/hang-up-call`;
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          establishment_id: establishment_id || null,
          conversation_id: conversation_id || null,
          reason: reason || 'Cierre normal de Qualification',
          timestamp: new Date().toISOString(),
        }),
      }).catch((err) => {
        logger.error('[hang_up_call Webhook] Error notificando backend:', {
          url: webhookUrl,
          error: err.message,
        });
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, message: 'Llamada terminada', hangUp: true }),
          },
        ],
      };
    }
  );

  return server;
}

module.exports = { createQualificationServer };
