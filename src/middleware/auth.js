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

// Middleware para autenticación JWT o API Key de servicio (para Ventas)
const authenticateJWTOrServiceKey = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const serviceKey = req.headers["x-service-key"];

    // DEBUG: Log de headers recibidos
    logger.debug("authenticateJWTOrServiceKey - Headers:", {
      hasAuthHeader: !!authHeader,
      hasServiceKey: !!serviceKey,
      serviceKeyReceived: serviceKey ? `${serviceKey.substring(0, 10)}...` : null,
      allHeaders: Object.keys(req.headers),
    });

    // Opción 1: JWT Bearer token
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, config.auth.jwtSecret);

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
      return next();
    }

    // Opción 2: Service Key para equipo de Ventas
    if (serviceKey) {
      // Verificar la clave de servicio
      const validServiceKey = process.env.VENTAS_SERVICE_KEY || "ventas-easyorder-2024";
      
      logger.debug("Service Key validation:", {
        received: serviceKey,
        expected: validServiceKey,
        match: serviceKey === validServiceKey,
      });
      
      if (serviceKey !== validServiceKey) {
        return res.status(401).json({
          success: false,
          error: "Service key inválida",
        });
      }

      // Obtener o crear un partner virtual para Ventas
      const salesPartnerId = req.headers["x-sales-user-id"] || "ventas-default";
      const salesUserName = req.headers["x-sales-user-name"] || "Equipo Ventas";
      const salesUserEmail = req.headers["x-sales-user-email"] || "ventas@easyorder.mx";

      // Buscar o crear el partner de Ventas
      let salesPartner = await prisma.partner.findUnique({
        where: { code: `VENTAS-${salesPartnerId}` },
      });

      if (!salesPartner) {
        // Crear usuario y partner para Ventas al vuelo
        const existingUser = await prisma.user.findUnique({
          where: { email: salesUserEmail },
        });

        if (existingUser) {
          salesPartner = await prisma.partner.findUnique({
            where: { userId: existingUser.id },
          });
          
          if (!salesPartner) {
            // Generar referralLink único para el partner de Ventas
            const referralCode = `VENTAS-${salesPartnerId}-${Date.now().toString(36)}`;
            salesPartner = await prisma.partner.create({
              data: {
                userId: existingUser.id,
                code: `VENTAS-${salesPartnerId}`,
                type: "TECHNOLOGY", // Equipo interno de ventas
                companyName: "EasyOrder Ventas",
                status: "ACTIVE",
                tier: "ELITE",
                referralLink: referralCode,
              },
            });
          }
          
          req.user = { ...existingUser, partner: salesPartner };
        } else {
          // Crear usuario y partner nuevos
          const bcrypt = require("bcryptjs");
          const passwordHash = await bcrypt.hash("ventas-internal-" + Date.now(), 10);
          
          const newUser = await prisma.user.create({
            data: {
              email: salesUserEmail,
              name: salesUserName,
              passwordHash,
              role: "PARTNER",
            },
          });

          // Generar referralLink único para el partner de Ventas
          const referralCode2 = `VENTAS-${salesPartnerId}-${Date.now().toString(36)}`;
          salesPartner = await prisma.partner.create({
            data: {
              userId: newUser.id,
              code: `VENTAS-${salesPartnerId}`,
              type: "TECHNOLOGY", // Equipo interno de ventas
              companyName: "EasyOrder Ventas",
              status: "ACTIVE",
              tier: "ELITE",
              referralLink: referralCode2,
            },
          });

          req.user = { ...newUser, partner: salesPartner };
        }
      } else {
        const user = await prisma.user.findUnique({
          where: { id: salesPartner.userId },
        });
        req.user = { ...user, partner: salesPartner };
      }

      logger.info(`Autenticación de servicio Ventas: ${salesUserEmail}`);
      return next();
    }

    // Ni JWT ni Service Key proporcionados
    logger.warn("Autenticación fallida: No se proporcionó JWT ni Service Key");
    return res.status(401).json({
      success: false,
      error: "Token de autenticación o service key requerido",
    });
  } catch (error) {
    logger.error("Error de autenticación:", {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        error: "Token expirado",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        error: "Token inválido",
      });
    }

    // Error al crear partner de Ventas u otro error
    return res.status(500).json({
      success: false,
      error: "Error interno de autenticación: " + error.message,
    });
  }
};

// Middleware de autenticación opcional (para rutas que funcionan con o sin auth)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const serviceKey = req.headers["x-service-key"];

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const decoded = jwt.verify(token, config.auth.jwtSecret);
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          include: { partner: true },
        });
        if (user) {
          req.user = user;
        }
      } catch {
        // Token inválido, continuar sin autenticación
      }
    } else if (serviceKey) {
      const validServiceKey = process.env.VENTAS_SERVICE_KEY || "ventas-easyorder-2024";
      if (serviceKey === validServiceKey) {
        // Configurar usuario de servicio mínimo
        req.isServiceKey = true;
      }
    }
    
    next();
  } catch {
    next();
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
  authenticateJWTOrServiceKey,
  optionalAuth,
  authenticateApiKey,
  requireAdmin,
  requireActivePartner,
  generateToken,
};

