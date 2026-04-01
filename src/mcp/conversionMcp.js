const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const svc = require("../services/funnelWebhookService");

function createConversionServer() {
  const server = new McpServer({ name: "funnel-conversion", version: "1.0.0" });

  server.tool(
    "calculate_roi",
    "Calcula ROI personalizado del cliente según su volumen y plan. Usar al inicio de la presentación de propuesta.",
    {
      conversation_id: z.string().describe("ID conversación ({{conversationId}})"),
      establishment_id: z.string().describe("ID establecimiento ({{establishment_id}})"),
      current_monthly_orders: z.number().int().describe("Pedidos mensuales actuales"),
      average_ticket: z.number().describe("Ticket promedio en MXN"),
      plan: z.enum(["BASIC", "PROFESSIONAL", "ENTERPRISE"]).describe("Plan a evaluar"),
    },
    async ({ conversation_id, establishment_id, current_monthly_orders, average_ticket, plan }) => {
      try {
        const result = await svc.calculateROI({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          currentMonthlyOrders: current_monthly_orders,
          averageTicket: average_ticket,
          plan,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "save_deal_terms",
    "Guarda los términos comerciales acordados durante la negociación.",
    {
      conversation_id: z.string(),
      establishment_id: z.string(),
      plan_selected: z.enum(["BASIC", "PROFESSIONAL", "ENTERPRISE"]),
      monthly_price: z.number().describe("Precio mensual final en MXN"),
      contract_duration: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]),
      discount_percent: z.number().optional().describe("% de descuento aplicado (0 si ninguno)"),
      start_date: z.string().optional().describe("Fecha de inicio ISO 8601"),
      payment_method: z.string().optional().describe("Forma de pago acordada"),
      notes: z.string().optional(),
    },
    async ({ conversation_id, establishment_id, plan_selected, monthly_price, contract_duration, discount_percent, start_date, payment_method, notes }) => {
      try {
        const result = await svc.saveDealTerms({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          planSelected: plan_selected,
          monthlyPrice: monthly_price,
          contractDuration: contract_duration,
          discountPercent: discount_percent,
          startDate: start_date,
          paymentMethod: payment_method,
          notes,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "schedule_onboarding",
    "Agenda la sesión de onboarding e implementación del nuevo cliente.",
    {
      conversation_id: z.string(),
      establishment_id: z.string(),
      contact_name: z.string(),
      email: z.string(),
      onboarding_date: z.string().describe("ISO 8601, ej: 2026-04-10T10:00:00-06:00"),
      plan_selected: z.string(),
      special_requirements: z.array(z.string()).optional().describe("Integraciones o requisitos especiales"),
    },
    async ({ conversation_id, establishment_id, contact_name, email, onboarding_date, plan_selected, special_requirements }) => {
      try {
        const result = await svc.scheduleOnboarding({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          contactName: contact_name,
          email,
          onboardingDate: onboarding_date,
          planSelected: plan_selected,
          specialRequirements: special_requirements,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  server.tool(
    "end_conversion_call",
    "Guarda el resultado final del cierre y actualiza el estado del lead. OBLIGATORIO antes de colgar.",
    {
      conversation_id: z.string(),
      establishment_id: z.string(),
      outcome: z.enum(["CLOSED_WON", "FOLLOW_UP_NEEDED", "OBJECTION_UNRESOLVED", "LOST"]),
      plan_closed: z.string().optional().describe("Plan cerrado (si CLOSED_WON)"),
      monthly_revenue: z.number().optional().describe("Ingreso mensual acordado en MXN"),
      call_summary: z.string().describe("Resumen del cierre"),
    },
    async ({ conversation_id, establishment_id, outcome, plan_closed, monthly_revenue, call_summary }) => {
      try {
        const result = await svc.endConversionCall({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          outcome,
          planClosed: plan_closed,
          monthlyRevenue: monthly_revenue,
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

module.exports = { createConversionServer };
