const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("../config/database");
const { generateToken } = require("../middleware/auth");
const partnerService = require("../services/partnerService");
const emailService = require("../services/emailService");
const notificationService = require("../services/notificationService");
const logger = require("../config/logger");
const { v4: uuidv4 } = require("uuid");

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

    // Enviar email de bienvenida (async, no bloquea)
    notificationService.notifyPartnerRegistered(user.id, partner)
      .catch(err => logger.error("Error sending welcome email:", err));

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

// OAuth callback - crear o vincular usuario desde proveedor OAuth
const oauthCallback = async (req, res, next) => {
  try {
    const { provider, providerAccountId, email, name, image, accessToken, refreshToken } = req.body;

    if (!provider || !providerAccountId || !email) {
      return res.status(400).json({
        success: false,
        error: "Datos de OAuth incompletos",
      });
    }

    // Buscar si ya existe una cuenta vinculada
    const existingAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      include: {
        user: {
          include: { partner: true },
        },
      },
    });

    if (existingAccount) {
      // Usuario ya tiene cuenta vinculada, hacer login
      const user = existingAccount.user;

      // Actualizar tokens si cambiaron
      await prisma.account.update({
        where: { id: existingAccount.id },
        data: {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      });

      // Registrar actividad de login
      if (user.partner) {
        await prisma.activity.create({
          data: {
            partnerId: user.partner.id,
            type: "LOGIN",
            description: `Inicio de sesión con ${provider}`,
          },
        });

        await prisma.partner.update({
          where: { id: user.partner.id },
          data: { lastActivityAt: new Date() },
        });
      }

      const token = generateToken(user);

      logger.info(`OAuth login exitoso: ${email} via ${provider}`);

      return res.json({
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
                  referralLink: user.partner.referralLink,
                }
              : null,
          },
        },
      });
    }

    // Buscar si existe un usuario con este email
    let user = await prisma.user.findUnique({
      where: { email },
      include: { partner: true },
    });

    if (user) {
      // Usuario existe pero sin esta cuenta OAuth vinculada
      // Vincular la cuenta
      await prisma.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider,
          providerAccountId,
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      });

      // Actualizar imagen si no tiene
      if (!user.image && image) {
        await prisma.user.update({
          where: { id: user.id },
          data: { image },
        });
      }

      const token = generateToken(user);

      logger.info(`OAuth cuenta vinculada: ${email} via ${provider}`);

      return res.json({
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
                  referralLink: user.partner.referralLink,
                }
              : null,
          },
        },
      });
    }

    // Usuario nuevo - crear cuenta
    const result = await prisma.$transaction(async (tx) => {
      // Crear usuario
      const newUser = await tx.user.create({
        data: {
          email,
          name: name || email.split("@")[0],
          role: "PENDING",
          image,
          emailVerified: new Date(), // OAuth verifica el email
        },
      });

      // Crear cuenta OAuth
      await tx.account.create({
        data: {
          userId: newUser.id,
          type: "oauth",
          provider,
          providerAccountId,
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      });

      // Crear partner con tipo AFFILIATE por defecto (puede cambiarse después)
      const code = `EO-${uuidv4().substring(0, 6).toUpperCase()}`;
      const partner = await tx.partner.create({
        data: {
          userId: newUser.id,
          code,
          type: "AFFILIATE",
          tier: "REGISTERED",
          status: "PENDING",
          commissionRate: 0.15,
          referralLink: `https://easyorder.mx/?ref=${code}`,
        },
      });

      // Registrar actividad
      await tx.activity.create({
        data: {
          partnerId: partner.id,
          type: "PARTNER_REGISTERED",
          description: `Partner registrado via ${provider}`,
        },
      });

      return { user: newUser, partner };
    });

    const token = generateToken(result.user);

    logger.info(`Nuevo usuario OAuth: ${email} via ${provider}`);

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
          partner: {
            id: result.partner.id,
            code: result.partner.code,
            type: result.partner.type,
            tier: result.partner.tier,
            status: result.partner.status,
            referralLink: result.partner.referralLink,
          },
        },
      },
    });
  } catch (error) {
    logger.error("Error en OAuth callback:", error);
    next(error);
  }
};

// Vincular cuenta OAuth adicional a usuario existente
const linkOAuthAccount = async (req, res, next) => {
  try {
    const { provider, providerAccountId, accessToken, refreshToken } = req.body;
    const userId = req.user.id;

    // Verificar si ya existe esta cuenta vinculada
    const existingAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
    });

    if (existingAccount) {
      if (existingAccount.userId === userId) {
        return res.json({
          success: true,
          message: "Esta cuenta ya está vinculada",
        });
      }
      return res.status(409).json({
        success: false,
        error: "Esta cuenta ya está vinculada a otro usuario",
      });
    }

    // Vincular cuenta
    await prisma.account.create({
      data: {
        userId,
        type: "oauth",
        provider,
        providerAccountId,
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    });

    logger.info(`Cuenta ${provider} vinculada a usuario ${userId}`);

    res.json({
      success: true,
      message: `Cuenta de ${provider} vinculada exitosamente`,
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// RECUPERACIÓN DE CONTRASEÑA
// ========================================

// Solicitar recuperación de contraseña
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    // Buscar usuario
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Siempre devolver éxito para no revelar si el email existe
    if (!user) {
      logger.info(`Forgot password attempt for non-existent email: ${email}`);
      return res.json({
        success: true,
        message: "Si el email existe, recibirás instrucciones para restablecer tu contraseña.",
      });
    }

    // Invalidar tokens anteriores no usados
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(), // Marcar como usado para invalidarlo
      },
    });

    // Generar nuevo token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // Enviar email
    try {
      await emailService.sendPasswordResetEmail(user.email, user.name, token);
      logger.info(`Password reset email sent to: ${email}`);
    } catch (emailError) {
      logger.error(`Failed to send password reset email to ${email}:`, emailError);
      // No fallar la solicitud si el email falla
    }

    res.json({
      success: true,
      message: "Si el email existe, recibirás instrucciones para restablecer tu contraseña.",
    });
  } catch (error) {
    next(error);
  }
};

// Restablecer contraseña con token
const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    // Buscar token válido
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken) {
      return res.status(400).json({
        success: false,
        error: "El enlace de recuperación es inválido.",
      });
    }

    if (resetToken.usedAt) {
      return res.status(400).json({
        success: false,
        error: "Este enlace ya fue utilizado. Solicita uno nuevo.",
      });
    }

    if (resetToken.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        error: "El enlace ha expirado. Solicita uno nuevo.",
      });
    }

    // Actualizar contraseña
    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    logger.info(`Password reset successful for user: ${resetToken.user.email}`);

    res.json({
      success: true,
      message: "Tu contraseña ha sido actualizada exitosamente.",
    });
  } catch (error) {
    next(error);
  }
};

// ========================================
// VERIFICACIÓN DE EMAIL
// ========================================

// Enviar email de verificación
const sendVerificationEmail = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Usuario no encontrado",
      });
    }

    if (user.emailVerified) {
      return res.json({
        success: true,
        message: "Tu email ya está verificado.",
      });
    }

    // Invalidar tokens anteriores
    await prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id },
    });

    // Generar nuevo token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // Enviar email
    try {
      await emailService.sendVerificationEmail(user.email, user.name, token);
      logger.info(`Verification email sent to: ${user.email}`);
    } catch (emailError) {
      logger.error(`Failed to send verification email to ${user.email}:`, emailError);
      return res.status(500).json({
        success: false,
        error: "Error al enviar el email de verificación. Intenta más tarde.",
      });
    }

    res.json({
      success: true,
      message: "Se ha enviado un email de verificación a tu correo.",
    });
  } catch (error) {
    next(error);
  }
};

// Verificar email con token
const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    // Buscar token válido
    const verificationToken = await prisma.emailVerificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!verificationToken) {
      return res.status(400).json({
        success: false,
        error: "El enlace de verificación es inválido.",
      });
    }

    if (verificationToken.expiresAt < new Date()) {
      // Eliminar token expirado
      await prisma.emailVerificationToken.delete({
        where: { id: verificationToken.id },
      });
      return res.status(400).json({
        success: false,
        error: "El enlace ha expirado. Solicita uno nuevo.",
      });
    }

    if (verificationToken.user.emailVerified) {
      // Ya verificado, eliminar token
      await prisma.emailVerificationToken.delete({
        where: { id: verificationToken.id },
      });
      return res.json({
        success: true,
        message: "Tu email ya está verificado.",
      });
    }

    // Verificar email
    await prisma.$transaction([
      prisma.user.update({
        where: { id: verificationToken.userId },
        data: { emailVerified: new Date() },
      }),
      prisma.emailVerificationToken.delete({
        where: { id: verificationToken.id },
      }),
    ]);

    logger.info(`Email verified for user: ${verificationToken.user.email}`);

    res.json({
      success: true,
      message: "Tu email ha sido verificado exitosamente.",
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
  oauthCallback,
  linkOAuthAccount,
  forgotPassword,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
};

