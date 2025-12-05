/**
 * Email Service
 * Maneja el envío de emails usando Resend
 */

const { Resend } = require("resend");
const prisma = require("../config/database");
const logger = require("../config/logger");

// Inicializar cliente de Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Email remitente por defecto
const DEFAULT_FROM = process.env.EMAIL_FROM || "EasyOrder Partners <noreply@partners.easyorder.mx>";

/**
 * Obtener plantilla de email de la BD
 */
async function getTemplate(templateName) {
  try {
    const template = await prisma.emailTemplate.findUnique({
      where: { name: templateName },
    });

    if (!template || !template.isActive) {
      return null;
    }

    return template;
  } catch (error) {
    logger.error(`Error getting template ${templateName}:`, error);
    return null;
  }
}

/**
 * Reemplazar variables en el template
 */
function replaceVariables(text, variables) {
  if (!text) return "";
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    result = result.replace(regex, String(value || ""));
  }
  return result;
}

/**
 * Generar HTML por defecto si no hay template
 */
function getDefaultHtml(variables) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
      <div style="background: linear-gradient(135deg, #FF8C00, #FF6B00); padding: 30px 20px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">EasyOrder Partners</h1>
      </div>
      <div style="padding: 40px 30px; background: #ffffff;">
        ${variables.name ? `<p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hola <strong>${variables.name}</strong>,</p>` : ""}
        <h2 style="color: #333; font-size: 22px; margin-bottom: 15px;">${variables.title || "Notificación"}</h2>
        <p style="color: #666; line-height: 1.7; font-size: 15px;">${variables.message || ""}</p>
        ${variables.actionUrl ? `
          <div style="text-align: center; margin: 30px 0;">
            <a href="${variables.actionUrl}" style="display: inline-block; background: linear-gradient(135deg, #FF8C00, #FF6B00); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">${variables.actionText || "Ver más"}</a>
          </div>
        ` : ""}
      </div>
      <div style="background: #f9f9f9; padding: 25px; text-align: center; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px; margin: 0;">Este email fue enviado por EasyOrder Partners</p>
        <p style="color: #999; font-size: 12px; margin: 5px 0 0 0;">© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Enviar email usando una plantilla
 */
async function sendTemplateEmail(templateName, to, variables = {}) {
  if (!process.env.RESEND_API_KEY) {
    logger.warn(`Email not sent (Resend not configured): ${templateName} to ${to}`);
    return null;
  }

  try {
    const template = await getTemplate(templateName);

    if (!template) {
      // Si no hay plantilla, usar una por defecto
      return sendEmail({
        to,
        subject: variables.title || "Notificación de EasyOrder Partners",
        html: getDefaultHtml(variables),
        text: `${variables.title || "Notificación"}\n\n${variables.message || ""}\n\n-- EasyOrder Partners`,
      });
    }

    const subject = replaceVariables(template.subject, variables);
    const html = replaceVariables(template.htmlBody, variables);
    const text = replaceVariables(template.textBody, variables);

    return sendEmail({ to, subject, html, text });
  } catch (error) {
    logger.error(`Error sending template email (${templateName}):`, error);
    throw error;
  }
}

/**
 * Enviar email directo usando Resend
 */
async function sendEmail({ to, subject, html, text, replyTo = null }) {
  if (!process.env.RESEND_API_KEY) {
    logger.warn(`Email not sent (Resend not configured): ${subject} to ${to}`);
    return null;
  }

  try {
    const emailOptions = {
      from: DEFAULT_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    };

    if (replyTo) {
      emailOptions.replyTo = replyTo;
    }

    const { data, error } = await resend.emails.send(emailOptions);

    if (error) {
      logger.error(`Resend error sending to ${to}:`, error);
      throw new Error(error.message);
    }

    logger.info(`Email sent: ${subject} to ${to} (ID: ${data.id})`);
    return { id: data.id, messageId: data.id };
  } catch (error) {
    logger.error(`Error sending email to ${to}:`, error);
    throw error;
  }
}

/**
 * Enviar email de prueba
 */
async function sendTestEmail(to) {
  return sendEmail({
    to,
    subject: "Test Email - EasyOrder Partners",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
      </head>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #FF8C00, #FF6B00); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">✅ Email de Prueba</h1>
          </div>
          <div style="padding: 30px;">
            <p style="color: #333; font-size: 16px;">Si recibes este email, la configuración de <strong>Resend</strong> es correcta.</p>
            <p style="color: #666; font-size: 14px; margin-top: 20px;">
              <strong>Fecha:</strong> ${new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}<br>
              <strong>Servicio:</strong> Resend API<br>
              <strong>Dominio:</strong> partners.easyorder.mx
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: "Email de prueba. Si recibes este email, la configuración de Resend es correcta.",
  });
}

/**
 * Enviar email de recuperación de contraseña
 */
async function sendPasswordResetEmail(to, name, resetToken) {
  const resetUrl = `${process.env.APP_URL || "https://partners.easyorder.mx"}/reset-password?token=${resetToken}`;
  
  return sendTemplateEmail("password_reset", to, {
    name,
    title: "Recupera tu contraseña",
    message: "Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón de abajo para crear una nueva contraseña. Este enlace expirará en 1 hora.",
    resetLink: resetUrl,
    actionUrl: resetUrl,
    actionText: "Restablecer Contraseña",
  });
}

/**
 * Enviar email de verificación
 */
async function sendVerificationEmail(to, name, verificationToken) {
  const verificationUrl = `${process.env.APP_URL || "https://partners.easyorder.mx"}/verify-email?token=${verificationToken}`;
  
  return sendTemplateEmail("email_verification", to, {
    name,
    title: "Verifica tu email",
    message: "Gracias por registrarte en EasyOrder Partners. Por favor verifica tu dirección de email haciendo clic en el botón de abajo.",
    verificationLink: verificationUrl,
    actionUrl: verificationUrl,
    actionText: "Verificar Email",
  });
}

/**
 * Enviar email de bienvenida
 */
async function sendWelcomeEmail(to, name, partnerCode, referralLink) {
  return sendTemplateEmail("welcome", to, {
    name,
    title: "¡Bienvenido a EasyOrder Partners!",
    message: "Tu solicitud ha sido recibida. Revisaremos tu información y te notificaremos cuando tu cuenta esté activa.",
    code: partnerCode,
    referralLink,
  });
}

/**
 * Enviar email de partner aprobado
 */
async function sendPartnerApprovedEmail(to, name, partnerCode, referralLink) {
  return sendTemplateEmail("partner_approved", to, {
    name,
    title: "¡Tu cuenta ha sido aprobada!",
    message: "¡Felicidades! Tu cuenta de partner ha sido aprobada. Ya puedes comenzar a generar leads y ganar comisiones.",
    code: partnerCode,
    referralLink,
    actionUrl: `${process.env.APP_URL || "https://partners.easyorder.mx"}/partner`,
    actionText: "Ir al Dashboard",
  });
}

module.exports = {
  sendEmail,
  sendTemplateEmail,
  sendTestEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPartnerApprovedEmail,
  getTemplate,
  replaceVariables,
};
