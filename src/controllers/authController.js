const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const { generateToken } = require("../middleware/auth");
const partnerService = require("../services/partnerService");
const logger = require("../config/logger");

// Registro de nuevo partner
const register = async (req, res, next) => {
  try {
    const { email, password, name, type, companyName, phone, website, country, state, city } = req.body;

    // Verificar si el email ya existe
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: "Ya existe una cuenta con este email",
      });
    }

    // Crear partner
    const { user, partner } = await partnerService.createPartner({
      email,
      password,
      name,
      type,
      companyName,
      phone,
      website,
      country,
      state,
      city,
    });

    logger.info(`Nuevo partner registrado: ${email}`);

    res.status(201).json({
      success: true,
      message: "Solicitud de partner recibida. Te contactaremos pronto.",
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        partner: {
          id: partner.id,
          code: partner.code,
          type: partner.type,
          status: partner.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// Login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Buscar usuario
    const user = await prisma.user.findUnique({
      where: { email },
      include: { partner: true },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({
        success: false,
        error: "Credenciales inválidas",
      });
    }

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: "Credenciales inválidas",
      });
    }

    // Verificar estado del partner
    if (user.partner && user.partner.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        error: "Tu cuenta está suspendida. Contacta a soporte.",
      });
    }

    // Registrar actividad de login
    if (user.partner) {
      await prisma.activity.create({
        data: {
          partnerId: user.partner.id,
          type: "LOGIN",
          description: "Inicio de sesión exitoso",
        },
      });

      await prisma.partner.update({
        where: { id: user.partner.id },
        data: { lastActivityAt: new Date() },
      });
    }

    // Generar token
    const token = generateToken(user);

    logger.info(`Login exitoso: ${email}`);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          partner: user.partner
            ? {
                id: user.partner.id,
                code: user.partner.code,
                type: user.partner.type,
                tier: user.partner.tier,
                status: user.partner.status,
              }
            : null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// Obtener usuario actual
const me = async (req, res) => {
  const user = req.user;

  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      partner: user.partner
        ? {
            id: user.partner.id,
            code: user.partner.code,
            type: user.partner.type,
            tier: user.partner.tier,
            status: user.partner.status,
            referralLink: user.partner.referralLink,
          }
        : null,
    },
  });
};

// Cambiar contraseña
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    // Verificar contraseña actual
    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
      return res.status(400).json({
        success: false,
        error: "La contraseña actual es incorrecta",
      });
    }

    // Actualizar contraseña
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    res.json({
      success: true,
      message: "Contraseña actualizada exitosamente",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  me,
  changePassword,
};

