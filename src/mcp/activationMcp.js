const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const svc = require("../services/funnelWebhookService");

function createActivationServer() {
  const server = new McpServer({ name: "funnel-activation", version: "1.0.0" });

  server.tool(
    "save_activation_data",
    "Guarda datos de activación capturados durante la conversación.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      pain_points_confirmed: z.array(z.string()).optional().describe("Pain points confirmados"),
      features_of_interest: z.array(z.string()).optional().describe("Funcionalidades que más interesan"),
      urgency_level: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Urgencia de implementación"),
      notes: z.string().optional(),
    },
    async ({ conversation_id, establishment_id, pain_points_confirmed, features_of_interest, urgency_level, notes }) => {
      try {
        const result = await svc.saveActivationData({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          painPointsConfirmed: pain_points_confirmed,
          featuresOfInterest: features_of_interest,
          urgencyLevel: urgency_level,
          notes,
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
    "Confirma o actualiza el email del contacto para enviar la invitación de Calendly.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
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
    "schedule_demo",
    "Agenda la demo en Calendly y envía confirmación al prospecto.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      contact_name: z.string().describe("Nombre del contacto"),
      email: z.string().describe("Email para la invitación"),
      start_time: z.string().describe("Fecha y hora en ISO 8601, ej: 2026-04-05T10:00:00-06:00"),
      features_of_interest: z.array(z.string()).optional(),
    },
    async ({ conversation_id, establishment_id, contact_name, email, start_time, features_of_interest }) => {
      try {
        const result = await svc.scheduleDemo({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          contactName: contact_name,
          email,
          startTime: start_time,
          featuresOfInterest: features_of_interest,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "end_activation_call",
    "Guarda el resultado final de la conversación de Activation y registra en campaign_enrichments. OBLIGATORIO antes de colgar.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      outcome: z.enum(["DEMO_SCHEDULED", "DEMO_DECLINED", "FOLLOW_UP_LATER", "NOT_INTERESTED"]).describe("Resultado de la conversación"),
      demo_date: z.string().optional().describe("Fecha agendada si aplica (ISO 8601)"),
      call_summary: z.string().describe("Resumen breve"),
    },
    async ({ conversation_id, establishment_id, outcome, demo_date, call_summary }) => {
      try {
        const result = await svc.endActivationCall({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          outcome,
          demoDate: demo_date,
          callSummary: call_summary,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  return server;
}

module.exports = { createActivationServer };
