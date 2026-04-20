const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const svc = require("../services/funnelWebhookService");

function createQualificationServer() {
  const server = new McpServer({ name: "funnel-qualification", version: "1.0.0" });

  server.tool(
    "save_qualification_result",
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
        const result = await svc.saveQualificationResult({
          conversationId: conversation_id,
          establishmentId: establishment_id,
          dailyOrdersRange: daily_orders_range,
          averageTicket: average_ticket,
          approximateSales: approximate_sales,
          employeeCount: employee_count,
          posCount: pos_count,
          branchCount: branch_count,
          disorderLevel: disorder_level,
          duplicateProcesses: duplicate_processes,
          currentTools: current_tools,
          timeImpact: time_impact,
          moneyImpact: money_impact,
          controlImpact: control_impact,
          problemPriority: problem_priority,
          resolutionIntent: resolution_intent,
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
    "end_qualification_call",
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
