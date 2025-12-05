const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authenticateJWT } = require("../middleware/auth");
const { validate } = require("../middleware/validation");
const { z } = require("zod");

// Schemas de validación
const registerSchema = z.object({
  body: z.object({
    email: z.string().email("Email inválido"),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
    name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
    type: z.enum(["AFFILIATE", "REFERRAL", "RESELLER", "SOLUTIONS", "TECHNOLOGY"]),
    companyName: z.string().optional(),
    phone: z.string().optional(),
    website: z.string().url().optional().or(z.literal("")),
    country: z.string().optional().default("MX"),
    state: z.string().optional(),
    city: z.string().optional(),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Email inválido"),
    password: z.string().min(1, "Contraseña requerida"),
  }),
});

const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "Contraseña actual requerida"),
    newPassword: z.string().min(8, "La nueva contraseña debe tener al menos 8 caracteres"),
  }),
});

const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email("Email inválido"),
  }),
});

const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, "Token requerido"),
    newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  }),
});

const verifyEmailSchema = z.object({
  body: z.object({
    token: z.string().min(1, "Token requerido"),
  }),
});

// Rutas públicas
router.post("/register", validate(registerSchema), authController.register);
router.post("/login", validate(loginSchema), authController.login);

// Recuperación de contraseña (públicas)
router.post("/forgot-password", validate(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), authController.resetPassword);

// Verificación de email (pública para el token)
router.post("/verify-email", validate(verifyEmailSchema), authController.verifyEmail);

// Rutas protegidas
router.get("/me", authenticateJWT, authController.me);
router.post("/change-password", authenticateJWT, validate(changePasswordSchema), authController.changePassword);
router.post("/send-verification", authenticateJWT, authController.sendVerificationEmail);

// OAuth routes
router.post("/oauth/callback", authController.oauthCallback);
router.post("/link-account", authenticateJWT, authController.linkOAuthAccount);

module.exports = router;

