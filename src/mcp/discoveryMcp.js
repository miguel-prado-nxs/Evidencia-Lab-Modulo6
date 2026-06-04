const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const svc = require("../services/funnelWebhookService");
const logger = require("../config/logger");
const config = require("../config/env");

// Devuelve null si el valor es un placeholder ElevenLabs sin reemplazar (ej: "{{callId}}")
// o si el valor es igual al nombre del parámetro (indicador de error del agente)
const sanitizeVar = (value, paramName) => {
  if (typeof value !== "string") return value || null;
  const v = value.trim();

  // Descarta placeholders sin resolver
  if (v.includes("{{") || v.includes("}}")) return null;

  // Descarta si el valor es igual al nombre del parámetro (ej: agente mandó "establishment_id" como valor)
  if (paramName && v.toLowerCase() === paramName.toLowerCase()) return null;

  return v || null;
};

// Normaliza enums: acepta valores en español y los mapea a inglés
const normalizeEnum = (value) => {
  if (!value || typeof value !== "string") return value;
  const normalized = value.trim().toUpperCase();
  const spanishToEnglish = {
    ALTO: "HIGH",
    ALTA: "HIGH",
    HIGH: "HIGH",
    MUY_ALTO: "HIGH",
    ALTO_INTERÉS: "HIGH",
    MUY_INTERESADO: "HIGH",
    MEDIO: "MEDIUM",
    MEDIA: "MEDIUM",
    MEDIUM: "MEDIUM",
    MODERADO: "MEDIUM",
    MEDIANO: "MEDIUM",
    BAJO: "LOW",
    BAJA: "LOW",
    LOW: "LOW",
    POCO_INTERÉS: "LOW",
    SIN_INTERÉS: "LOW",
  };

  // Primero intenta mapeo exacto
  if (spanishToEnglish[normalized]) return spanishToEnglish[normalized];

  // Si no encuentra, intenta inferir por palabras clave (usar normalized en MAYÚSCULAS)
  if (
    normalized.includes("ALTO") ||
    normalized.includes("MUCHO") ||
    normalized.includes("MUY") ||
    normalized.includes("INTEGRAR") ||
    normalized.includes("MEJORAR") ||
    normalized.includes("URGENTE") ||
    normalized.includes("INMEDIATO") ||
    normalized.includes("IMPORTANTE")
  ) {
    return "HIGH";
  }

  if (
    normalized.includes("CONFUSIÓN") ||
    normalized.includes("POCO") ||
    normalized.includes("NO") ||
    normalized.includes("SIN") ||
    normalized.includes("BAJO") ||
    normalized.includes("CLARO")
  ) {
    return "LOW";
  }

  // Default a MEDIUM
  return "MEDIUM";
};

function createDiscoveryServer() {
  const server = new McpServer({ name: "funnel-discovery", version: "1.0.0" });

  server.tool(
    "save_discovery_data",
    "Guarda temporalmente la información de descubrimiento capturada durante la conversación. Llamar cada vez que se obtiene un nuevo dato.",
    {
      conversation_id: z.string().describe("ID de la conversación ElevenLabs ({{system__conversation_id}})"),
      establishment_id: z.string().describe("ID del establecimiento ({{establishment_id}})"),
      contact_name: z.string().optional().describe("Nombre del contacto"),
      contact_email: z.string().optional().describe("Email del decision maker (para envios posteriores)"),
      business_type: z.string().optional().describe("Tipo de negocio"),
      pain_point: z.string().optional().describe("Principal problema identificado"),
      interest_level: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Nivel de interés evaluado"),
      notes: z.string().optional().describe("Notas adicionales"),
      restaurant_name: z.string().optional().describe("Nombre del restaurante"),
      restaurant_age: z.string().optional().describe("Antigüedad del restaurante"),
      branch_count: z.coerce.number().optional().describe("Cantidad de sucursales"),
      sales_channel: z.union([z.string(), z.array(z.string())]).optional().describe("Canal de ventas (mostrador, whatsapp, apps, llamadas)"),
      order_method: z.string().optional().describe("Método de pedido (mesa, takeout, delivery)"),
      closing_method: z.string().optional().describe("Método de cierre (mesa, takeout, delivery)"),
      main_difficulty: z.string().optional().describe("Dificultad principal identificada"),
      frequent_errors: z.string().optional().describe("Errores frecuentes identificados"),
      time_lost: z.string().optional().describe("Tiempo perdido estimado"),
      closing_clarity: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Claridad en el cierre"),
      previous_systems: z.string().optional().describe("Sistemas previos utilizados"),
      improvement_interest: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Interés en mejoras"),
      problem_priority: z.enum(["HIGH", "MEDIUM", "LOW", "NONE"]).optional().describe("Prioridad del problema"),
    },
    async ({ conversation_id, establishment_id, contact_name, contact_email, business_type, pain_point, interest_level, notes, restaurant_name, restaurant_age, branch_count, sales_channel, order_method, closing_method, main_difficulty, frequent_errors, time_lost, closing_clarity, previous_systems, improvement_interest, problem_priority }) => {
      try {
        const result = await svc.saveDiscoveryData({
          conversationId: sanitizeVar(conversation_id, "conversation_id"),
          establishmentId: sanitizeVar(establishment_id, "establishment_id"),
          contactName: contact_name,
          contactEmail: contact_email,
          businessType: business_type,
          painPoint: pain_point,
          interestLevel: normalizeEnum(interest_level),
          notes,
          restaurantName: restaurant_name,
          restaurantAge: restaurant_age,
          branchCount: branch_count,
          salesChannel: sales_channel,
          orderMethod: order_method,
          closingMethod: closing_method,
          mainDifficulty: main_difficulty,
          frequentErrors: frequent_errors,
          timeLost: time_lost,
          closingClarity: normalizeEnum(closing_clarity),
          previousSystems: previous_systems,
          improvementInterest: normalizeEnum(improvement_interest),
          problemPriority: normalizeEnum(problem_priority),
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "end_discovery_call",
    "Guarda el resultado final de la conversación de Discovery y registra en campaign_enrichments. OBLIGATORIO antes de colgar.",
    {
      conversation_id: z.string().describe("ID de la conversación ElevenLabs ({{system__conversation_id}})"),
      establishment_id: z.string().describe("ID del establecimiento ({{establishment_id}})"),
      outcome: z.enum(["INTERESTED", "FOLLOW_UP_LATER", "NOT_INTERESTED", "WRONG_NUMBER", "NO_ANSWER", "VOICEMAIL"]).describe("RESULTADO DE LA LLAMADA: INTERESTED (mostró interés), FOLLOW_UP_LATER (llamar después), NOT_INTERESTED (no interesado), WRONG_NUMBER (número incorrecto), NO_ANSWER (sin respuesta), VOICEMAIL (buzón de voz)"),
      contact_name: z.string().optional().describe("Nombre del contacto o decision maker"),
      business_type: z.string().optional().describe("Tipo de negocio (ej: restaurante, panadería, cafetería)"),
      pain_point: z.string().optional().describe("Problema principal identificado en la conversación"),
      interest_level: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("NIVEL DE INTERÉS del prospecto: HIGH (muy interesado), MEDIUM (moderadamente interesado), LOW (poco interesado). NOTA: Esto es DIFERENTE del outcome."),
      call_summary: z.string().describe("Resumen breve de la conversación (2-3 oraciones sobre lo que pasó)"),
    },
    async ({ conversation_id, establishment_id, outcome, contact_name, business_type, pain_point, interest_level, call_summary }) => {
      try {
        // Mapear INTERESTED a ADVANCE_TO_ACTIVATION para callStatus
        const mappedOutcome = outcome === "INTERESTED" ? "ADVANCE_TO_ACTIVATION" : outcome;

        const result = await svc.endDiscoveryCall({
          conversationId: sanitizeVar(conversation_id, "conversation_id"),
          establishmentId: sanitizeVar(establishment_id, "establishment_id"),
          outcome: mappedOutcome,
          originalOutcome: outcome,
          contactName: contact_name,
          businessType: business_type,
          painPoint: pain_point,
          interestLevel: normalizeEnum(interest_level),
          callSummary: call_summary,
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
          conversationId: sanitizeVar(conversation_id, "conversation_id"),
          establishmentId: sanitizeVar(establishment_id, "establishment_id"),
          detectionReason: detection_reason,
          transcriptSnippet: transcript_snippet,
          detectedAt: new Date().toISOString(),
        });

        // NUEVO: Notificar al backend INMEDIATAMENTE por webhook
        // Esto permite detectar voicemail en segundos en lugar de esperar
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
              message: "VOICEMAIL DETECTED. CALL end_discovery_call IMMEDIATELY with outcome='VOICEMAIL'. DO NOT SPEAK. DO NOT WAIT.",
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
    "send_whatsapp_info",
    "Envía un mensaje informativo básico de EasyOrder por WhatsApp al prospecto. SIEMPRE ejecutar al finalizar la llamada, sin importar el resultado (incluso buzón de voz o sin respuesta).",
    {
      conversation_id: z.string().describe("ID conversación ({{system__conversation_id}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      phone: z.string().describe("Teléfono del prospecto"),
      prospect_name: z.string().optional().describe("Nombre del prospecto (si se obtuvo)"),
      business_name: z.string().optional().describe("Nombre del negocio (si se obtuvo)"),
    },
    async ({ conversation_id, establishment_id, phone, prospect_name, business_name }) => {
      try {
        const result = await svc.sendWhatsappInfo({
          conversationId: sanitizeVar(conversation_id, "conversation_id"),
          establishmentId: sanitizeVar(establishment_id, "establishment_id"),
          phone: sanitizeVar(phone, "phone"),
          prospectName: sanitizeVar(prospect_name, "prospect_name"),
          businessName: sanitizeVar(business_name, "business_name"),
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "hang_up_call",
    "Cuelga la llamada inmediatamente. Notifica al backend para terminar la sesión en ElevenLabs.",
    {
      establishment_id: z.string().optional().describe("ID del establecimiento ({{establishment_id}})"),
      conversation_id: z.string().optional().describe("ID de la conversación ({{system__conversation_id}})"),
      reason: z.string().optional().describe("Razón del cierre")
    },
    async ({ establishment_id, conversation_id, reason }) => {
      logger.info("[hang_up_call] Cierre de llamada solicitado", { establishment_id, conversation_id, reason });

      // Notificar al backend para que cuelgue la llamada
      const webhookUrl = `${config.server.apiBaseUrl || 'http://localhost:3004'}/api/v1/webhooks/elevenlabs/hang-up-call`;
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          establishment_id: establishment_id || null,
          conversation_id: conversation_id || null,
          reason: reason || "Cierre normal de Discovery",
          timestamp: new Date().toISOString(),
        })
      }).catch(err => {
        logger.error("[hang_up_call Webhook] Error notificando backend:", {
          url: webhookUrl,
          error: err.message
        });
      });

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

module.exports = { createDiscoveryServer };
