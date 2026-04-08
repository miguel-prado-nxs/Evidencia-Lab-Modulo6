const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const svc = require("../services/funnelWebhookService");

function createQualificationServer() {
  const server = new McpServer({ name: "funnel-qualification", version: "1.0.0" });

  server.tool(
    "save_qualification_result",
    "Guarda el scoring BANT/FPDI parcial o completo. Llamar después de cada área BANT explorada.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      need_score: z.number().int().describe("Puntaje Need 0-10, -1 si no explorado"),
      authority_score: z.number().int().describe("Puntaje Authority 0-10, -1 si no explorado"),
      budget_score: z.number().int().describe("Puntaje Budget 0-10, -1 si no explorado"),
      timeline_score: z.number().int().describe("Puntaje Timeline 0-10, -1 si no explorado"),
      fear: z.string().optional().describe("Fear identificado"),
      pain: z.string().optional().describe("Pain identificado"),
      desire: z.string().optional().describe("Desire identificado"),
      intent: z.string().optional().describe("Intent identificado"),
      qualification_notes: z.string().optional().describe("Notas adicionales"),
    },
    async ({ conversation_id, establishment_id, need_score, authority_score, budget_score, timeline_score, fear, pain, desire, intent, qualification_notes }) => {
      try {
        const result = await svc.saveQualificationResult({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          needScore: need_score,
          authorityScore: authority_score,
          budgetScore: budget_score,
          timelineScore: timeline_score,
          fear,
          pain,
          desire,
          intent,
          qualificationNotes: qualification_notes,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "send_coupon_whatsapp",
    "Genera un cupón REAL en la base de datos y lo envía por WhatsApp. El sistema selecciona el template correcto según coupon_type o scenario. SOLO usar si el prospecto califica y acepta recibirlo.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      phone: z.string().optional().describe("Teléfono del prospecto ({{phoneNumber}}). Opcional, si no lo tienes omítelo y el sistema lo buscará."),
      coupon_type: z.string().optional().describe("Tipo de cupón elegido según árbol de decisión ({{couponType}}). Si no se especifica, se usa el cupón principal."),
      scenario: z.string().optional().describe("Escenario detectado en la conversación (ej: price_objection, first_contact, trial_ending, upgrade_interest, referral, cold_lead). Se usa para analíticas y para seleccionar template si no se especificó coupon_type."),
      prospect_name: z.string().optional().describe("Nombre del prospecto para personalizar el mensaje ({{prospectName}})"),
      business_name: z.string().optional().describe("Nombre del negocio ({{businessName}})"),
    },
    async ({ conversation_id, establishment_id, phone, coupon_type, scenario, prospect_name, business_name }) => {
      try {
        const result = await svc.sendCouponWhatsapp({
          conversationId: conversation_id,
          establishmentId: establishment_id,
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
    "get_calendly_availability",
    "Consulta los próximos slots disponibles en Calendly para agendar la demo.",
    {
      days_ahead: z.number().int().optional().default(7).describe("Días hacia adelante a consultar"),
    },
    async ({ days_ahead }) => {
      try {
        const result = await svc.getCalendlyAvailability({ daysAhead: days_ahead });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "confirm_or_update_email",
    "Confirma o actualiza el email del contacto antes de agendar la demo.",
    {
      conversation_id: z.string(),
      establishment_id: z.string(),
      email: z.string().describe("Email confirmado del contacto"),
    },
    async ({ conversation_id, establishment_id, email }) => {
      try {
        const result = await svc.confirmOrUpdateEmail({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          email,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "schedule_calendly_demo",
    "Agenda la demo en Calendly incluyendo los scores BANT y FPDI.",
    {
      conversation_id: z.string(),
      establishment_id: z.string(),
      contact_name: z.string(),
      email: z.string(),
      start_time: z.string().describe("ISO 8601, ej: 2026-04-05T10:00:00-06:00"),
      bant_scores: z.object({
        need: z.number().int().optional(),
        authority: z.number().int().optional(),
        budget: z.number().int().optional(),
        timeline: z.number().int().optional(),
      }).optional(),
      fpdi: z.object({
        fear: z.string().optional(),
        pain: z.string().optional(),
        desire: z.string().optional(),
        intent: z.string().optional(),
      }).optional(),
    },
    async ({ conversation_id, establishment_id, contact_name, email, start_time, bant_scores, fpdi }) => {
      try {
        const result = await svc.scheduleCalendlyDemo({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          contactName: contact_name,
          email,
          startTime: start_time,
          bantScores: bant_scores,
          fpdi,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "handle_negative_response",
    "Registra el rechazo de demo y sugiere fecha de seguimiento.",
    {
      conversation_id: z.string(),
      establishment_id: z.string(),
      reason: z.string().optional().describe("Motivo del rechazo"),
      follow_up_date: z.string().optional().describe("Fecha sugerida de seguimiento (ISO 8601)"),
    },
    async ({ conversation_id, establishment_id, reason, follow_up_date }) => {
      try {
        const result = await svc.handleNegativeResponse({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          reason,
          followUpDate: follow_up_date,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "end_and_close",
    "Guarda el resultado final de calificación. Llamar antes de end_call.",
    {
      conversation_id: z.string(),
      establishment_id: z.string(),
      outcome: z.enum(["DEMO_SCHEDULED", "NOT_INTERESTED", "FOLLOW_UP", "DISQUALIFIED", "NO_ANSWER", "VOICEMAIL"]),
      qualification_score: z.enum(["A", "B", "C", "D"]).optional(),
      coupon_sent: z.boolean().optional(),
      call_summary: z.string(),
    },
    async ({ conversation_id, establishment_id, outcome, qualification_score, coupon_sent, call_summary }) => {
      try {
        const result = await svc.endAndClose({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          outcome,
          qualificationScore: qualification_score,
          couponSent: coupon_sent,
          callSummary: call_summary,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "end_call",
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

  return server;
}

module.exports = { createQualificationServer };
