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
      account_created: z.boolean().optional().describe("Si se creó la cuenta en el proceso"),
      business_registered: z.boolean().optional().describe("Si el negocio ya está registrado"),
      menu_loaded: z.boolean().optional().describe("Si se cargó el menú en el proceso"),
      first_order_registered: z.boolean().optional().describe("Si se registró la primera orden en el proceso"),
      confusion_areas: z.array(z.string()).optional().describe("Áreas de confusión o dudas del usuario"),
      resolve_first: z.string().optional().describe("Acción prioritaria a resolver"),
      implementation_time: z.string().optional().describe("Tiempo estimado de implementación"),
      solo_or_team: z.string().optional().describe("Si el usuario prefiere implementar solo o con equipo"),
      perceived_complexity: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().describe("Complejidad percibida por el usuario"),
    },
    async ({ conversation_id, establishment_id, pain_points_confirmed, features_of_interest, urgency_level, notes, account_created, business_registered, menu_loaded, first_order_registered, confusion_areas, resolve_first, implementation_time, solo_or_team, perceived_complexity }) => {
      try {
        const result = await svc.saveActivationData({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          painPointsConfirmed: pain_points_confirmed,
          featuresOfInterest: features_of_interest,
          urgencyLevel: urgency_level,
          notes,
          accountCreated: account_created,
          businessRegistered: business_registered,
          menuLoaded: menu_loaded,
          firstOrderRegistered: first_order_registered,
          confusionAreas: confusion_areas,
          resolveFirst: resolve_first,
          implementationTime: implementation_time,
          soloOrTeam: solo_or_team,
          perceivedComplexity: perceived_complexity
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
    "end_activation_call",
    "Guarda el resultado final de la conversación de Activation y registra en campaign_enrichments. OBLIGATORIO antes de colgar.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      outcome: z.enum([
        "ACTIVATED",
        "DEMO_SCHEDULED",
        "DEMO_DECLINED",
        "FOLLOW_UP_LATER",
        "NOT_INTERESTED",
      ]).describe("Outcome PLG: ACTIVATED (cuenta creada y pasa a LEAD), DEMO_SCHEDULED, DEMO_DECLINED, FOLLOW_UP_LATER, NOT_INTERESTED"),
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
