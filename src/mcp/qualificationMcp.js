const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const svc = require("../services/funnelWebhookService");
const logger = require("../config/logger");
const config = require("../config/env");

// Normaliza enums: acepta valores en español y los mapea a inglés
const normalizeEnum = (value, options = {}) => {
  if (!value || typeof value !== "string") return value;
  const normalized = value.trim().toUpperCase();
  const spanishToEnglish = {
    ALTO: "HIGH",
    HIGH: "HIGH",
    MUY_ALTO: "HIGH",
    URGENTE: "HIGH",
    URGENCIA: "HIGH",
    INMEDIATO: "HIGH",
    AHORITA: "HIGH",
    CUANTO_ANTES: "HIGH",
    MEDIO: "MEDIUM",
    MEDIA: "MEDIUM",
    MEDIUM: "MEDIUM",
    MODERADO: "MEDIUM",
    MEDIANO: "MEDIUM",
    BAJO: "LOW",
    LOW: "LOW",
    MUY_BAJO: "LOW",
    NO_URGENTE: "LOW",
    PUEDE_ESPERAR: "LOW",
    SIN_PRISA: "LOW",
  };

  // Primero intenta mapeo exacto
  if (spanishToEnglish[normalized]) return spanishToEnglish[normalized];

  // Si no encuentra mapeo exacto, intenta inferir por palabras clave
  // IMPORTANTE: Detectar negaciones PRIMERO para evitar falsos positivos
  if (
    normalized.includes("NO URGENTE") ||
    normalized.includes("NO ES URGENTE") ||
    normalized.includes("PUEDE ESPERAR") ||
    normalized.includes("SIN PRISA") ||
    normalized.includes("CUANDO PUEDAN") ||
    normalized.includes("DESPUÉS") ||
    normalized.includes("ESPERAR")
  ) {
    return "LOW";
  }

  if (
    normalized.includes("ESTE MES") ||
    normalized.includes("SEMANA") ||
    normalized.includes("AHORA") ||
    normalized.includes("RÁPIDO") ||
    normalized.includes("URGENTE") ||
    normalized.includes("INMEDIATO") ||
    normalized.includes("CUANTO ANTES") ||
    normalized.includes("PRONTO")
  ) {
    return "HIGH";
  }

  // Default a MEDIUM si está en el medio
  return "MEDIUM";
};

function createQualificationServer() {
  const server = new McpServer({ name: "funnel-qualification", version: "1.0.0" });

  server.tool(
    "save_qualification_data",
    "Guarda información de calificación con datos operacionales y de marketing. Llamar después de explorar cada área.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      daily_orders_range: z.string().optional().describe("Rango preciso de pedidos diarios"),
      average_ticket: z.number().optional().describe("Ticket promedio en pesos"),
      approximate_sales: z.string().optional().describe("Ventas aproximadas mensuales"),
      employee_count: z.number().int().optional().describe("Empleados en operación"),
      pos_count: z.number().int().optional().describe("Cajas/puntos de venta"),
      branch_count: z.number().int().optional().describe("Sucursales"),
      disorder_level: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Nivel de desorden operacional"),
      duplicate_processes: z.string().optional().describe("Procesos duplicados identificados"),
      current_tools: z.string().optional().describe("Herramientas actuales que usa"),
      time_impact: z.string().optional().describe("Impacto en tiempo"),
      money_impact: z.string().optional().describe("Impacto en dinero"),
      control_impact: z.string().optional().describe("Impacto en control"),
      problem_priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Prioridad del problema"),
      resolution_intent: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Intención de resolver"),
      decision_maker: z.string().optional().describe("Quién toma la decisión"),
      decision_process: z.string().optional().describe("Proceso de decisión (solo o con alguien más)"),
      evaluating_options: z.boolean().optional().describe("¿Evalúa otras opciones?"),
      previous_system_experience: z.string().optional().describe("Qué no funcionó antes"),
      implementation_horizon: z.string().optional().describe("Horizonte de implementación (corto/mediano/largo)"),
      qualification_notes: z.string().optional().describe("Notas generales"),
    },
    async ({ conversation_id, establishment_id, daily_orders_range, average_ticket, approximate_sales, employee_count, pos_count, branch_count, disorder_level, duplicate_processes, current_tools, time_impact, money_impact, control_impact, problem_priority, resolution_intent, decision_maker, decision_process, evaluating_options, previous_system_experience, implementation_horizon, qualification_notes }) => {
      try {
        // Normalizar enums: mapear valores españoles a inglés
        const result = await svc.saveQualificationResult({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          dailyOrdersRange: daily_orders_range,
          averageTicket: average_ticket,
          approximateSales: approximate_sales,
          employeeCount: employee_count,
          posCount: pos_count,
          branchCount: branch_count,
          disorderLevel: normalizeEnum(disorder_level, ["HIGH", "MEDIUM", "LOW"]),
          duplicateProcesses: duplicate_processes,
          currentTools: current_tools,
          timeImpact: time_impact,
          moneyImpact: money_impact,
          controlImpact: control_impact,
          problemPriority: normalizeEnum(problem_priority, ["HIGH", "MEDIUM", "LOW"]),
          resolutionIntent: normalizeEnum(resolution_intent, ["HIGH", "MEDIUM", "LOW"]),
          decisionMaker: decision_maker,
          decisionProcess: decision_process,
          evaluatingOptions: evaluating_options,
          previousSystemExperience: previous_system_experience,
          implementationHorizon: implementation_horizon,
          qualificationNotes: qualification_notes,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "mark_voicemail_detected",
    "Marca que se detectó un buzón de voz y registra el evento. Úsala cuando identifiques patrones de buzón: 'grave su mensaje', 'marque la tecla', menús automatizados, tonos DTMF, o falta de respuesta humana coherente en 2 turnos. Después de llamar a esta tool, debes llamar inmediatamente a la system tool voicemail_detection para terminar la llamada.",
    {
      conversation_id: z.string(),
      establishment_id: z.string(),
      detection_reason: z.string().describe("Por qué detectaste el buzón (ej: 'escuché: grave su mensaje después del tono')"),
      transcript_snippet: z.string().optional().describe("Fragmento del audio que confirmó que es buzón"),
    },
    async ({ conversation_id, establishment_id, detection_reason, transcript_snippet }) => {
      try {
        // Registrar en tu DB que cayó en voicemail
        const result = await svc.markVoicemail({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          detectionReason: detection_reason,
          transcriptSnippet: transcript_snippet,
          detectedAt: new Date().toISOString(),
        });

        // NUEVO: Notificar al backend INMEDIATAMENTE por webhook
        const webhookUrl = `${config.server.apiBaseUrl || 'http://localhost:3004'}/api/v1/webhooks/elevenlabs/voicemail-detected`;
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            establishment_id,
            conversation_id,
            status: "voicemail",
            detection_reason,
            timestamp: new Date().toISOString(),
          })
        }).catch(err => {
          logger.error("[mark_voicemail_detected Webhook] Error notificando backend:", {
            url: webhookUrl,
            error: err.message
          });
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "VOICEMAIL DETECTED. CALL end_qualification_call IMMEDIATELY with outcome='VOICEMAIL'. DO NOT SPEAK. DO NOT WAIT.",
              ...result
            })
          }]
        };
      } catch (err) {
        logger.error('[mark_voicemail_detected ERROR]', err);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err.message,
              fallback: "Call voicemail_detection system tool immediately to end call"
            })
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "end_qualification_call",
    "Señal de fin de llamada. Llamar siempre al final, después de end_and_close.",
    {
      conversation_id: z.string().optional(),
      establishment_id: z.string().optional(),
    },
    async ({ conversation_id, establishment_id }) => {
      try {
        const result = await svc.endCall({ conversationId: conversation_id, establishmentId: establishment_id });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "hang_up_call",
    "Cuelga la llamada inmediatamente. Usar DESPUÉS de end_qualification_call.",
    {
      reason: z.string().optional().describe("Razón del cierre")
    },
    async ({ reason }) => {
      logger.info("[hang_up_call] Cierre de llamada solicitado", { reason });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, message: "Llamada terminada", hangUp: true })
        }]
      };
    }
  );

  return server;
}

module.exports = { createQualificationServer };
