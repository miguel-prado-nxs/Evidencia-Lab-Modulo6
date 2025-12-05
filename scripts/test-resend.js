/**
 * Script de prueba para Resend Email Service
 * 
 * Uso: node scripts/test-resend.js [email]
 * 
 * Prueba la conexión con Resend y envía emails de prueba.
 */

require("dotenv").config();
const { Resend } = require("resend");

// Colores para la consola
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.cyan}═══ ${msg} ═══${colors.reset}\n`),
};

async function main() {
  log.header("Resend Email Service Test");

  // Verificar configuración
  const apiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM || "EasyOrder Partners <noreply@partners.easyorder.mx>";
  const testEmail = process.argv[2];

  log.info(`API Key configurada: ${apiKey ? `${apiKey.substring(0, 10)}...` : "NO CONFIGURADA"}`);
  log.info(`Email From: ${emailFrom}`);

  if (!apiKey) {
    log.error("RESEND_API_KEY no está configurada en las variables de entorno");
    log.info("Configura RESEND_API_KEY en tu archivo .env");
    process.exit(1);
  }

  if (!testEmail) {
    log.warn("No se especificó un email de prueba");
    log.info("Uso: node scripts/test-resend.js tu@email.com");
    log.info("\nSolo se verificará la conexión con la API...\n");
  }

  // Inicializar Resend
  const resend = new Resend(apiKey);

  // Test 1: Verificar API Key
  log.header("Test 1: Verificar conexión con Resend API");
  
  try {
    // Intentar listar dominios como prueba de conexión
    const { data: domains, error } = await resend.domains.list();
    
    if (error) {
      log.error(`Error de API: ${error.message}`);
    } else {
      log.success("Conexión con Resend API exitosa");
      if (domains && domains.data) {
        log.info(`Dominios configurados: ${domains.data.length}`);
        domains.data.forEach(domain => {
          log.info(`  - ${domain.name} (${domain.status})`);
        });
      }
    }
  } catch (err) {
    log.error(`Error conectando con Resend: ${err.message}`);
  }

  // Test 2: Enviar email de prueba
  if (testEmail) {
    log.header("Test 2: Enviar email de prueba");
    
    try {
      const { data, error } = await resend.emails.send({
        from: emailFrom,
        to: testEmail,
        subject: "🧪 Test Email - EasyOrder Partners",
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
          </head>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #FF8C00, #FF6B00); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0;">✅ Test Exitoso</h1>
            </div>
            <div style="padding: 30px; background: #fff; border: 1px solid #eee; border-radius: 0 0 8px 8px;">
              <h2 style="color: #333;">¡La configuración de Resend es correcta!</h2>
              <p style="color: #666; line-height: 1.6;">
                Si estás viendo este email, significa que la integración con Resend está funcionando correctamente.
              </p>
              <div style="background: #f5f5f5; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <p style="margin: 5px 0; font-size: 14px;"><strong>Fecha:</strong> ${new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</p>
                <p style="margin: 5px 0; font-size: 14px;"><strong>Servicio:</strong> Resend API</p>
                <p style="margin: 5px 0; font-size: 14px;"><strong>Dominio:</strong> partners.easyorder.mx</p>
                <p style="margin: 5px 0; font-size: 14px;"><strong>Ambiente:</strong> ${process.env.NODE_ENV || "development"}</p>
              </div>
              <p style="color: #999; font-size: 12px;">
                Este es un email automático de prueba enviado desde el script test-resend.js
              </p>
            </div>
          </body>
          </html>
        `,
        text: "Test Email - La configuración de Resend es correcta. Fecha: " + new Date().toISOString(),
      });

      if (error) {
        log.error(`Error enviando email: ${error.message}`);
        if (error.name) log.error(`Tipo de error: ${error.name}`);
      } else {
        log.success(`Email enviado exitosamente`);
        log.info(`ID del email: ${data.id}`);
        log.info(`Destinatario: ${testEmail}`);
      }
    } catch (err) {
      log.error(`Error: ${err.message}`);
    }
  }

  // Test 3: Verificar templates de email
  log.header("Test 3: Verificar templates de email en BD");
  
  try {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();

    const templates = await prisma.emailTemplate.findMany({
      select: {
        name: true,
        subject: true,
        isActive: true,
      },
    });

    if (templates.length === 0) {
      log.warn("No hay templates de email en la base de datos");
      log.info("Ejecuta: npm run seed:emails");
    } else {
      log.success(`${templates.length} templates encontrados:`);
      templates.forEach(t => {
        const status = t.isActive ? colors.green + "activo" : colors.red + "inactivo";
        log.info(`  - ${t.name}: "${t.subject}" (${status}${colors.reset})`);
      });
    }

    await prisma.$disconnect();
  } catch (err) {
    if (err.message.includes("Can't reach database")) {
      log.warn("No se pudo conectar a la base de datos");
      log.info("Verifica que DATABASE_URL esté configurado correctamente");
    } else {
      log.warn(`Error verificando templates: ${err.message}`);
    }
  }

  // Resumen
  log.header("Resumen");
  log.info("Configuración de Resend:");
  log.info(`  API Key: ${apiKey ? "✓ Configurada" : "✗ No configurada"}`);
  log.info(`  Email From: ${emailFrom}`);
  log.info(`  App URL: ${process.env.APP_URL || "https://partners.easyorder.mx"}`);
  
  if (!testEmail) {
    log.info("\nPara enviar un email de prueba, ejecuta:");
    log.info("  node scripts/test-resend.js tu@email.com");
  }

  console.log();
}

main().catch(console.error);

