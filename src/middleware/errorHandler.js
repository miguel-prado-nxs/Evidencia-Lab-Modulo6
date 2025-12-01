const logger = require("../config/logger");

// Manejador de errores centralizado
const errorHandler = (err, req, res, next) => {
  logger.error("Error:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Errores de Prisma
  if (err.code === "P2002") {
    return res.status(409).json({
      success: false,
      error: "Ya existe un registro con esos datos únicos",
    });
  }

  if (err.code === "P2025") {
    return res.status(404).json({
      success: false,
      error: "Registro no encontrado",
    });
  }

  // Errores de validación de Zod
  if (err.name === "ZodError") {
    return res.status(400).json({
      success: false,
      error: "Error de validación",
      details: err.errors,
    });
  }

  // Error por defecto
  const statusCode = err.statusCode || 500;
  const message = err.message || "Error interno del servidor";

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

// Manejador de rutas no encontradas
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: `Ruta no encontrada: ${req.method} ${req.path}`,
  });
};

module.exports = { errorHandler, notFoundHandler };

