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
};

module.exports = config;

