/**
 * Email Service
 * Maneja el envío de emails usando Nodemailer
 */

const nodemailer = require("nodemailer");
const prisma = require("../config/database");
const logger = require("../config/logger");

// Configuración del transporter
let transporter = null;

/**
 * Inicializar el transporter de email
 */
function initTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    logger.warn("SMTP not configured. Email sending disabled.");
    return null;
  }

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  // Verificar conexión
  transporter.verify((error) => {
    if (error) {
      logger.error("SMTP connection error:", error);
    } else {
      logger.info("SMTP server ready");
    }
  });

  return transporter;
}

/**
 * Obtener plantilla de email de la BD
 */
async function getTemplate(templateName) {
  const template = await prisma.emailTemplate.findUnique({
    where: { name: templateName },
  });

  if (!template || !template.isActive) {
    return null;
  }

  return template;
}

/**
 * Reemplazar variables en el template
 */
function replaceVariables(text, variables) {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    result = result.replace(regex, String(value || ""));
  }
  return result;
}

/**
 * Enviar email usando una plantilla
 */
async function sendTemplateEmail(templateName, to, variables = {}) {
  if (!transporter) {
    logger.warn(`Email not sent (SMTP not configured): ${templateName} to ${to}`);
    return null;
  }

  try {
    const template = await getTemplate(templateName);

    if (!template) {
      // Si no hay plantilla, usar una por defecto
      return sendEmail({
        to,
        subject: variables.title || "Notificación de EasyOrder Partners",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #FF8C00, #FF6B00); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">EasyOrder Partners</h1>
            </div>
            <div style="padding: 30px; background: #ffffff;">
              <h2 style="color: #333;">${variables.title || "Notificación"}</h2>
              <p style="color: #666; line-height: 1.6;">${variables.message || ""}</p>
              ${variables.name ? `<p style="color: #666;">Hola ${variables.name},</p>` : ""}
            </div>
            <div style="background: #f5f5f5; padding: 20px; text-align: center; color: #999; font-size: 12px;">
              <p>Este email fue enviado por EasyOrder Partners</p>
              <p>© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
            </div>
          </div>
        `,
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
 * Enviar email directo
 */
async function sendEmail({ to, subject, html, text }) {
  if (!transporter) {
    logger.warn(`Email not sent (SMTP not configured): ${subject} to ${to}`);
    return null;
  }

  try {
    const from = process.env.EMAIL_FROM || "partners@easyorder.mx";

    const result = await transporter.sendMail({
      from: `"EasyOrder Partners" <${from}>`,
      to,
      subject,
      text,
      html,
    });

    logger.info(`Email sent: ${subject} to ${to} (${result.messageId})`);
    return result;
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
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h1>Email de Prueba</h1>
        <p>Si recibes este email, la configuración de SMTP es correcta.</p>
        <p>Fecha: ${new Date().toISOString()}</p>
      </div>
    `,
    text: "Email de prueba. Si recibes este email, la configuración de SMTP es correcta.",
  });
}

// Inicializar transporter al cargar el módulo
initTransporter();

module.exports = {
  initTransporter,
  sendEmail,
  sendTemplateEmail,
  sendTestEmail,
  getTemplate,
};

