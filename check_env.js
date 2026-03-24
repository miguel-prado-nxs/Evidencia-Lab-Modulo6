const config = require("./src/config/env");
console.log("ALLOWED_ORIGINS:", config.security.allowedOrigins);
console.log("SERVER PORT:", config.server.port);
