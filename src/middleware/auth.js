const jwt = require("jsonwebtoken");
const prisma = require("../config/database");
const config = require("../config/env");
const logger = require("../config/logger");

// Middleware para verificar JWT
const authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Token de autenticación requerido",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, config.auth.jwtSecret);

    // Buscar usuario en la base de datos
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { partner: true },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Usuario no encontrado",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error("Error de autenticación:", error);

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        error: "Token expirado",
      });
    }

    return res.status(401).json({
      success: false,
      error: "Token inválido",
    });
  }
};

// Middleware para verificar API Key (para integraciones)
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "API Key requerida",
      });
    }

    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
    });

    if (!keyRecord || !keyRecord.isActive) {
      return res.status(401).json({
        success: false,
        error: "API Key inválida o inactiva",
      });
    }

    if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
      return res.status(401).json({
        success: false,
        error: "API Key expirada",
      });
    }

    // Actualizar último uso
    await prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    });

    req.apiKey = keyRecord;
    next();
  } catch (error) {
    logger.error("Error de autenticación API Key:", error);
    return res.status(500).json({
      success: false,
      error: "Error de autenticación",
    });
  }
};

// Middleware para verificar rol de admin
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      error: "Acceso denegado. Se requiere rol de administrador.",
    });
  }
  next();
};

// Middleware para verificar partner activo
const requireActivePartner = (req, res, next) => {
  if (!req.user || !req.user.partner) {
    return res.status(403).json({
      success: false,
      error: "No tienes un perfil de partner asociado.",
    });
  }

  if (req.user.partner.status !== "ACTIVE") {
    return res.status(403).json({
      success: false,
      error: "Tu cuenta de partner no está activa.",
    });
  }

  next();
};

// Generar token JWT
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn }
  );
};

module.exports = {
  authenticateJWT,
  authenticateApiKey,
  requireAdmin,
  requireActivePartner,
  generateToken,
};

