require("dotenv").config();

const config = {
  server: {
    port: parseInt(process.env.PORT || "3004", 10),
    nodeEnv: process.env.NODE_ENV || "development",
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || "your-secret-key",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    apiKeySecret: process.env.API_KEY_SECRET || "api-key-secret",
  },
  security: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost:3003").split(","),
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
  // Twenty CRM Integration
  twenty: {
    baseUrl: process.env.TWENTY_BASE_URL || "https://api.crm.development.easyorder.mx",
    apiKey: process.env.TWENTY_API_KEY || "",
    // Worker configuration
    syncEnabled: process.env.TWENTY_SYNC_ENABLED !== "false",
    syncIntervalMs: parseInt(process.env.TWENTY_SYNC_INTERVAL_MS || "10000", 10),
    maxRetries: parseInt(process.env.TWENTY_MAX_RETRIES || "5", 10),
  },
};

module.exports = config;

