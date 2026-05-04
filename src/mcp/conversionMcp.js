const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const svc = require("../services/funnelWebhookService");
const logger = require("../config/logger");
const config = require("../config/env");

// Normaliza enums: acepta valores en español y los mapea a inglés
const normalizeEnum = (value, enumType) => {
  if (!value || typeof value !== "string") return value;
  const normalized = value.trim().toUpperCase();

  if (enumType === "objectionType") {
    const objectionMap = {
      PRICE: "PRICE",
      PRECIO: "PRICE",
      RISK: "RISK",
      RIESGO: "RISK",
      COMPLEXITY: "COMPLEXITY",
      COMPLEJIDAD: "COMPLEXITY",
      TIME: "TIME",
      TIEMPO: "TIME",
      PRIORITY: "PRIORITY",
      PRIORIDAD: "PRIORITY",
      OTHER: "OTHER",
      OTRO: "OTHER",
    };
    return objectionMap[normalized] || value;
  }

  if (enumType === "decisionStatus") {
    const decisionMap = {
      READY: "READY",
      LISTO: "READY",
      PREPARADO: "READY",
      NEEDS_TIME: "NEEDS_TIME",
      NECESITA_TIEMPO: "NEEDS_TIME",
      NECESITA_ANALIZAR: "NEEDS_TIME",
      FOLLOW_UP_LATER: "NEEDS_TIME",
      NEEDS_VALIDATION: "NEEDS_VALIDATION",
      NECESITA_VALIDACIÓN: "NEEDS_VALIDATION",
      NEEDS_REVIEW: "NEEDS_VALIDATION",
      NOT_NOW: "NOT_NOW",
      AHORA_NO: "NOT_NOW",
      POR_AHORA_NO: "NOT_NOW",
    };
    return decisionMap[normalized] || value;
  }

  if (enumType === "perceivedValue") {
    const valueMap = {
      LOW: "LOW",
      BAJO: "LOW",
      MEDIUM: "MEDIUM",
      MEDIO: "MEDIUM",
      MEDIA: "MEDIUM",
      HIGH: "HIGH",
      ALTO: "HIGH",
      MUY_ALTO: "HIGH",
    };
    return valueMap[normalized] || value;
  }

  return value;
};

function createConversionServer() {
  const server = new McpServer({ name: "funnel-conversion", version: "1.0.0" });

  server.tool(
    "send_coupon_whatsapp",
    "Genera un cupón REAL en la base de datos y lo envía por WhatsApp. El sistema selecciona el template correcto según coupon_type o scenario. SOLO usar si el prospecto califica y acepta recibirlo.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      campaign_id: z.string().optional().describe("ID de la campaña. DEBES extraer obligatoriamente el valor de tu variable dinámica {{campaignId}} y enviarlo aquí."), campaign_contact_id: z.string().optional().describe("ID contacto campaña ({{campaignContactId}})"),
      phone: z.string().optional().describe("Teléfono del prospecto ({{phoneNumber}}). Opcional, si no lo tienes omítelo y el sistema lo buscará."),
      coupon_type: z.string().optional().describe("Tipo de cupón elegido según árbol de decisión ({{couponType}}). Si no se especifica, se usa el cupón principal."),
      scenario: z.string().optional().describe("Escenario detectado en la conversación (ej: price_objection, first_contact, trial_ending, upgrade_interest, referral, cold_lead). Se usa para analíticas y para seleccionar template si no se especificó coupon_type."),
      prospect_name: z.string().optional().describe("Nombre del prospecto para personalizar el mensaje ({{prospectName}})"),
      business_name: z.string().optional().describe("Nombre del negocio ({{businessName}})"),
    },
    async ({ conversation_id, establishment_id, campaign_id, campaign_contact_id, phone, coupon_type, scenario, prospect_name, business_name }) => {
      try {
        const result = await svc.sendCouponWhatsapp({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          campaignId: campaign_id,
          campaignContactId: campaign_contact_id,
          phone,
          coupon: {},
          couponType: coupon_type,
          scenario,
          prospectName: prospect_name,
          businessName: business_name,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "save_objection_data",
    "Guarda los datos de objeciones encontradas durante la conversación de Activation. Llamar cuando se identifique una objeción.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      objection_type: z.enum(["PRICE", "RISK", "COMPLEXITY", "TIME", "PRIORITY", "OTHER"]).describe("Tipo de objeción identificada"),
      objection_detail: z.string().describe("Descripción detallada de la objeción"),
      objection_resolved: z.boolean().describe("¿Se resolvió la objeción?"),
      resolution_method: z.string().optional().describe("Método usado para resolver la objeción (ej: cupón, demostración, explicación, seguimiento)"),
    },
    async ({ conversation_id, establishment_id, objection_type, objection_detail, objection_resolved, resolution_method }) => {
      try {
        const result = await svc.saveObjectionData({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          objectionType: normalizeEnum(objection_type, "objectionType"),
          objectionDetail: objection_detail,
          objectionResolved: objection_resolved,
          resolutionMethod: resolution_method,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "save_conversation_outcome",
    "Guarda el resultado final de la conversación de Activation y registra en campaign_enrichments. OBLIGATORIO antes de colgar.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      decision_status: z.enum(["READY", "NEEDS_TIME", "NEEDS_VALIDATION", "NOT_NOW"]).describe("Estado final de la conversación"),
      decision_timeline: z.string().describe("Timeline de la decisión (ej: 'dentro de 1 semana', 'después de revisar presupuesto')"),
      depends_on_others: z.boolean().describe("¿Depende de otras personas?"),
      conditions_to_advance: z.string().describe("Condiciones necesarias para avanzar (ej: 'confirmar presupuesto', 'revisar disponibilidad')"),
      perceived_value: z.enum(["LOW", "MEDIUM", "HIGH"]).describe("Valor percibido del producto/servicio"),
      coupon_offered: z.boolean().describe("¿Se ofreció un cupón?"),
      coupon_type_offered: z.string().optional().describe("Tipo de cupón ofrecido (ej: 'descuento', 'bonificación', 'trial')"),
    },
    async ({ conversation_id, establishment_id, decision_status, decision_timeline, depends_on_others, conditions_to_advance, perceived_value, coupon_offered, coupon_type_offered }) => {
      try {
        const result = await svc.saveConversationOutcome({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          decisionStatus: normalizeEnum(decision_status, "decisionStatus"),
          decisionTimeline: decision_timeline,
          dependsOnOthers: depends_on_others,
          conditionsToAdvance: conditions_to_advance,
          perceivedValue: normalizeEnum(perceived_value, "perceivedValue"),
          couponOffered: coupon_offered,
          couponTypeOffered: coupon_type_offered,
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
              message: "Voicemail detected and logged. Now call voicemail_detection system tool to end the call.",
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
    "end_conversion_call",
    "Guarda el resultado final del cierre y actualiza el estado del lead. OBLIGATORIO antes de colgar.",
    {
      conversation_id: z.string(),
      establishment_id: z.string(),
      outcome: z.enum(["CLOSED_WON", "READY", "NEEDS_TIME", "NEEDS_VALIDATION", "NOT_NOW", "LOST", "FOLLOW_UP_LATER"]),
      plan_closed: z.string().optional().describe("Plan cerrado (si CLOSED_WON)"),
      monthly_revenue: z.number().optional().describe("Ingreso mensual acordado en MXN"),
      call_summary: z.string().describe("Resumen del cierre"),
      decision_timeline: z.string().optional().describe("Timeline de la decisión (ej: 'dentro de 1 semana', 'después de revisar presupuesto')"),
      next_steps: z.string().optional().describe("Próximos pasos acordados"),
    },
    async ({ conversation_id, establishment_id, outcome, plan_closed, monthly_revenue, call_summary, decision_timeline, next_steps }) => {
      try {
        // Mapear FOLLOW_UP_LATER a NEEDS_TIME
        const mappedOutcome = outcome === "FOLLOW_UP_LATER" ? "NEEDS_TIME" : outcome;

        const result = await svc.endConversionCall({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          outcome: mappedOutcome,
          planClosed: plan_closed,
          monthlyRevenue: monthly_revenue,
          callSummary: call_summary,
          decisionTimeline: decision_timeline,
          nextSteps: next_steps,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  return server;
}

module.exports = { createConversionServer };
