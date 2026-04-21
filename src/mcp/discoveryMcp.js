const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const svc = require("../services/funnelWebhookService");

function createDiscoveryServer() {
  const server = new McpServer({ name: "funnel-discovery", version: "1.0.0" });

  server.tool(
    "save_discovery_data",
    "Guarda temporalmente la información de descubrimiento capturada durante la conversación. Llamar cada vez que se obtiene un nuevo dato.",
    {
      conversation_id: z.string().describe("ID de la conversación ElevenLabs ({{conversationId}})"),
      establishment_id: z.string().describe("ID del establecimiento ({{establishment_id}})"),
      contact_name: z.string().optional().describe("Nombre del contacto"),
      business_type: z.string().optional().describe("Tipo de negocio"),
      pain_point: z.string().optional().describe("Principal problema identificado"),
      interest_level: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Nivel de interés evaluado"),
      notes: z.string().optional().describe("Notas adicionales"),
      restaurant_name: z.string().optional().describe("Nombre del restaurante"),
      restaurant_age: z.string().optional().describe("Antigüedad del restaurante"),
      branch_count: z.number().optional().describe("Cantidad de sucursales"),
      sales_channel: z.array(z.string()).optional().describe("Canal de ventas (mostrador, whatsapp, apps, llamadas)"),
      order_method: z.string().optional().describe("Método de pedido (mesa, takeout, delivery)"),
      closing_method: z.string().optional().describe("Método de cierre (mesa, takeout, delivery)"),
      main_difficulty: z.string().optional().describe("Dificultad principal identificada"),
      frequent_errors: z.string().optional().describe("Errores frecuentes identificados"),
      time_lost: z.string().optional().describe("Tiempo perdido estimado"),
      closing_clarity: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Claridad en el cierre"),
      previous_systems: z.string().optional().describe("Sistemas previos utilizados"),
      improvement_interest: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Interés en mejoras"),
      problem_priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Prioridad del problema"),
    },
    async ({ conversation_id, establishment_id, contact_name, business_type, pain_point, interest_level, notes, restaurant_name, restaurant_age, branch_count, sales_channel, order_method, closing_method, main_difficulty, frequent_errors, time_lost, closing_clarity, previous_systems, improvement_interest, problem_priority }) => {
      try {
        const result = await svc.saveDiscoveryData({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          contactName: contact_name,
          businessType: business_type,
          painPoint: pain_point,
          interestLevel: interest_level,
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
          closingClarity: closing_clarity,
          previousSystems: previous_systems,
          improvementInterest: improvement_interest,
          problemPriority: problem_priority,
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
      conversation_id: z.string().describe("ID de la conversación ElevenLabs ({{conversationId}})"),
      establishment_id: z.string().describe("ID del establecimiento ({{establishment_id}})"),
      outcome: z.enum(["INTERESTED", "ADVANCE_TO_ACTIVATION", "FOLLOW_UP_LATER", "NOT_INTERESTED", "WRONG_NUMBER", "NO_ANSWER", "VOICEMAIL"]),
      contact_name: z.string().optional(),
      business_type: z.string().optional(),
      pain_point: z.string().optional(),
      interest_level: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
      call_summary: z.string().describe("Resumen breve de la conversación"),
    },
    async ({ conversation_id, establishment_id, outcome, contact_name, business_type, pain_point, interest_level, call_summary }) => {
      try {
        // Mapear INTERESTED a ADVANCE_TO_ACTIVATION
        const mappedOutcome = outcome === "INTERESTED" ? "ADVANCE_TO_ACTIVATION" : outcome;

        const result = await svc.endDiscoveryCall({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          outcome: mappedOutcome,
          contactName: contact_name,
          businessType: business_type,
          painPoint: pain_point,
          interestLevel: interest_level,
          callSummary: call_summary,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "send_whatsapp_info",
    "Envía un mensaje informativo básico de EasyOrder por WhatsApp al prospecto. SIEMPRE ejecutar al finalizar la llamada, sin importar el resultado (incluso buzón de voz o sin respuesta).",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      phone: z.string().describe("Teléfono del prospecto"),
      prospect_name: z.string().optional().describe("Nombre del prospecto (si se obtuvo)"),
      business_name: z.string().optional().describe("Nombre del negocio (si se obtuvo)"),
    },
    async ({ conversation_id, establishment_id, phone, prospect_name, business_name }) => {
      try {
        const result = await svc.sendWhatsappInfo({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          phone,
          prospectName: prospect_name,
          businessName: business_name,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  return server;
}

module.exports = { createDiscoveryServer };
