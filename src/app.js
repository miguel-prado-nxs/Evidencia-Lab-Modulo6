const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const config = require("./config/env");
const logger = require("./config/logger");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

// Importar rutas
const authRoutes = require("./routes/auth");
const partnersRoutes = require("./routes/partners");
const leadsRoutes = require("./routes/leads");
const dealsRoutes = require("./routes/deals");
const commissionsRoutes = require("./routes/commissions");
const analyticsRoutes = require("./routes/analytics");

// Crear aplicación Express
const app = express();

// ===========================================
// MIDDLEWARE DE SEGURIDAD Y CONFIGURACIÓN
// ===========================================

// Helmet para headers de seguridad
app.use(helmet());

// CORS configurado
app.use(
  cors({
    origin: config.security.allowedOrigins,
    credentials: true,
  })
);

// Parse JSON
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    success: false,
    error: "Demasiadas solicitudes, intenta de nuevo más tarde",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", limiter);

// Logging de requests
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  next();
});

// ===========================================
// RUTAS PÚBLICAS (Sin autenticación)
// ===========================================

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "EasyOrder Partners API está funcionando correctamente",
    timestamp: new Date().toISOString(),
    environment: config.server.nodeEnv,
  });
});

// Info de la API
app.get("/api/v1", (req, res) => {
  res.json({
    success: true,
    name: "EasyOrder Partners API",
    version: "1.0.0",
    description: "API para el sistema de partners de EasyOrder",
    endpoints: {
      auth: "/api/v1/auth",
      partners: "/api/v1/partners",
      leads: "/api/v1/leads",
      deals: "/api/v1/deals",
      commissions: "/api/v1/commissions",
      analytics: "/api/v1/analytics",
    },
    authentication: "JWT Bearer token en header Authorization",
    documentation: "Ver README.md",
  });
});

// ===========================================
// RUTAS DE LA API
// ===========================================

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/partners", partnersRoutes);
app.use("/api/v1/leads", leadsRoutes);
app.use("/api/v1/deals", dealsRoutes);
app.use("/api/v1/commissions", commissionsRoutes);
app.use("/api/v1/analytics", analyticsRoutes);

// ===========================================
// MANEJO DE ERRORES
// ===========================================

// 404 - Ruta no encontrada
app.use(notFoundHandler);

// Manejador de errores centralizado
app.use(errorHandler);

// ===========================================
// INICIAR SERVIDOR
// ===========================================

const PORT = config.server.port;

app.listen(PORT, () => {
  logger.info(`🚀 EasyOrder Partners API iniciada en puerto ${PORT}`);
  logger.info(`🌍 Ambiente: ${config.server.nodeEnv}`);
  logger.info(`📊 API: http://localhost:${PORT}/api/v1`);
  logger.info(`🏥 Health check: http://localhost:${PORT}/health`);
});

// Manejo de errores no capturados
process.on("unhandledRejection", (err) => {
  logger.error("Unhandled Rejection:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
  process.exit(1);
});

module.exports = app;

