const winston = require("winston");
const config = require("./env");

const safeStringify = (value) => {
  const seen = new WeakSet();

  try {
    return JSON.stringify(value, (key, currentValue) => {
      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }

      if (typeof currentValue === "function") {
        return `[Function ${currentValue.name || "anonymous"}]`;
      }

      return currentValue;
    });
  } catch {
    return "[Unserializable metadata]";
  }
};

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "easyorder-partners-api" },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? safeStringify(meta) : ""
            }`;
        })
      ),
    }),
  ],
});

module.exports = logger;

