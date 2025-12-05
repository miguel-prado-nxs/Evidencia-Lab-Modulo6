/**
 * Seed de Email Templates para EasyOrder Partners
 * 
 * Ejecutar: npm run seed:emails
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Estilos base para emails
const baseStyles = `
  body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5; }
  .header { background: linear-gradient(135deg, #FF8C00, #FF6B00); padding: 30px 20px; text-align: center; }
  .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 700; }
  .content { padding: 40px 30px; background: #ffffff; }
  .content h2 { color: #333; font-size: 22px; margin-bottom: 15px; }
  .content p { color: #666; line-height: 1.7; font-size: 15px; margin-bottom: 15px; }
  .button { display: inline-block; background: linear-gradient(135deg, #FF8C00, #FF6B00); color: white !important; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 20px 0; }
  .footer { background: #f9f9f9; padding: 25px; text-align: center; border-top: 1px solid #eee; }
  .footer p { color: #999; font-size: 12px; margin: 5px 0; }
  .highlight { background: #fff8f0; border-left: 4px solid #FF8C00; padding: 15px 20px; margin: 20px 0; }
  .code { background: #f5f5f5; padding: 10px 15px; border-radius: 6px; font-family: monospace; font-size: 18px; letter-spacing: 2px; color: #333; }
`;

// Templates de email
const templates = [
  {
    name: "welcome",
    subject: "¡Bienvenido a EasyOrder Partners, {{name}}!",
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header">
    <h1>🎉 ¡Bienvenido a EasyOrder Partners!</h1>
  </div>
  <div class="content">
    <p>Hola <strong>{{name}}</strong>,</p>
    <h2>Tu solicitud ha sido recibida</h2>
    <p>Gracias por aplicar al programa de partners de EasyOrder. Estamos emocionados de que quieras formar parte de nuestro equipo.</p>
    <p>Nuestro equipo revisará tu información y te contactaremos en las próximas 24-48 horas para continuar con el proceso.</p>
    <div class="highlight">
      <p><strong>Tu código de partner:</strong></p>
      <p class="code">{{code}}</p>
      <p style="margin-top: 15px;"><strong>Tu link de referido:</strong></p>
      <p style="word-break: break-all;"><a href="{{referralLink}}">{{referralLink}}</a></p>
    </div>
    <p>Mientras tanto, puedes iniciar sesión en tu dashboard para familiarizarte con la plataforma.</p>
    <div style="text-align: center;">
      <a href="{{actionUrl}}" class="button">Ir a mi Dashboard</a>
    </div>
  </div>
  <div class="footer">
    <p>Este email fue enviado por EasyOrder Partners</p>
    <p>© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
  </div>
</body>
</html>
    `,
    textBody: `¡Bienvenido a EasyOrder Partners, {{name}}!

Tu solicitud ha sido recibida. Nuestro equipo la revisará y te contactaremos en las próximas 24-48 horas.

Tu código de partner: {{code}}
Tu link de referido: {{referralLink}}

-- EasyOrder Partners`,
    variables: { name: "Nombre del partner", code: "Código de partner", referralLink: "Link de referido", actionUrl: "URL del dashboard" },
  },
  {
    name: "email_verification",
    subject: "Verifica tu email - EasyOrder Partners",
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header">
    <h1>📧 Verifica tu Email</h1>
  </div>
  <div class="content">
    <p>Hola <strong>{{name}}</strong>,</p>
    <h2>Confirma tu dirección de email</h2>
    <p>Para completar tu registro en EasyOrder Partners, necesitamos verificar tu dirección de email.</p>
    <p>Haz clic en el botón de abajo para verificar tu cuenta:</p>
    <div style="text-align: center;">
      <a href="{{verificationLink}}" class="button">Verificar mi Email</a>
    </div>
    <p style="color: #999; font-size: 13px;">Este enlace expirará en 24 horas. Si no solicitaste esta verificación, puedes ignorar este email.</p>
    <div class="highlight">
      <p style="font-size: 13px;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
      <p style="word-break: break-all; font-size: 12px;">{{verificationLink}}</p>
    </div>
  </div>
  <div class="footer">
    <p>Este email fue enviado por EasyOrder Partners</p>
    <p>© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
  </div>
</body>
</html>
    `,
    textBody: `Verifica tu email - EasyOrder Partners

Hola {{name}},

Para completar tu registro, verifica tu email haciendo clic en el siguiente enlace:

{{verificationLink}}

Este enlace expirará en 24 horas.

-- EasyOrder Partners`,
    variables: { name: "Nombre del usuario", verificationLink: "URL de verificación" },
  },
  {
    name: "password_reset",
    subject: "Recupera tu contraseña - EasyOrder Partners",
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header">
    <h1>🔐 Recupera tu Contraseña</h1>
  </div>
  <div class="content">
    <p>Hola <strong>{{name}}</strong>,</p>
    <h2>¿Olvidaste tu contraseña?</h2>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en EasyOrder Partners.</p>
    <p>Haz clic en el botón de abajo para crear una nueva contraseña:</p>
    <div style="text-align: center;">
      <a href="{{resetLink}}" class="button">Restablecer Contraseña</a>
    </div>
    <p style="color: #999; font-size: 13px;"><strong>Este enlace expirará en 1 hora</strong> por razones de seguridad.</p>
    <div class="highlight">
      <p style="font-size: 13px;">⚠️ Si no solicitaste este cambio, ignora este email. Tu contraseña permanecerá sin cambios.</p>
    </div>
    <p style="font-size: 13px; color: #999;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
    <span style="word-break: break-all;">{{resetLink}}</span></p>
  </div>
  <div class="footer">
    <p>Este email fue enviado por EasyOrder Partners</p>
    <p>© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
  </div>
</body>
</html>
    `,
    textBody: `Recupera tu contraseña - EasyOrder Partners

Hola {{name}},

Recibimos una solicitud para restablecer tu contraseña. Haz clic en el siguiente enlace:

{{resetLink}}

Este enlace expirará en 1 hora.

Si no solicitaste este cambio, ignora este email.

-- EasyOrder Partners`,
    variables: { name: "Nombre del usuario", resetLink: "URL de reset" },
  },
  {
    name: "new_lead",
    subject: "🎯 Nuevo Lead: {{businessName}}",
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header">
    <h1>🎯 ¡Tienes un Nuevo Lead!</h1>
  </div>
  <div class="content">
    <p>Hola <strong>{{name}}</strong>,</p>
    <h2>Se ha registrado un nuevo lead en tu cuenta</h2>
    <div class="highlight">
      <p><strong>Negocio:</strong> {{businessName}}</p>
      <p><strong>Contacto:</strong> {{contactName}}</p>
      <p><strong>Email:</strong> {{email}}</p>
      {{#if phone}}<p><strong>Teléfono:</strong> {{phone}}</p>{{/if}}
    </div>
    <p>Te recomendamos contactar a este lead lo antes posible para aumentar las probabilidades de conversión.</p>
    <div style="text-align: center;">
      <a href="{{actionUrl}}" class="button">Ver Detalles del Lead</a>
    </div>
  </div>
  <div class="footer">
    <p>Este email fue enviado por EasyOrder Partners</p>
    <p>© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
  </div>
</body>
</html>
    `,
    textBody: `¡Tienes un Nuevo Lead!

Hola {{name}},

Se ha registrado un nuevo lead:

Negocio: {{businessName}}
Contacto: {{contactName}}
Email: {{email}}

Te recomendamos contactarlo lo antes posible.

-- EasyOrder Partners`,
    variables: { name: "Nombre del partner", businessName: "Nombre del negocio", contactName: "Nombre del contacto", email: "Email del lead", phone: "Teléfono", actionUrl: "URL del lead" },
  },
  {
    name: "deal_closed",
    subject: "🎉 ¡Felicidades! Cerraste una venta: {{businessName}}",
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header">
    <h1>🎉 ¡Venta Cerrada!</h1>
  </div>
  <div class="content">
    <p>Hola <strong>{{name}}</strong>,</p>
    <h2>¡Felicidades por cerrar esta venta!</h2>
    <p>Tu lead <strong>{{businessName}}</strong> se ha convertido en cliente de EasyOrder.</p>
    <div class="highlight">
      <p><strong>Negocio:</strong> {{businessName}}</p>
      <p><strong>Valor Total:</strong> ${{totalValue}} MXN</p>
      <p style="font-size: 18px; color: #FF8C00;"><strong>Tu Comisión:</strong> ${{commissionAmount}} MXN</p>
    </div>
    <p>La comisión será procesada y recibirás una notificación cuando esté lista para ser pagada.</p>
    <div style="text-align: center;">
      <a href="{{actionUrl}}" class="button">Ver mis Comisiones</a>
    </div>
    <p>¡Sigue así! Cada venta te acerca más al siguiente nivel del programa.</p>
  </div>
  <div class="footer">
    <p>Este email fue enviado por EasyOrder Partners</p>
    <p>© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
  </div>
</body>
</html>
    `,
    textBody: `¡Felicidades, {{name}}!

Cerraste una venta:

Negocio: {{businessName}}
Valor Total: ${{totalValue}} MXN
Tu Comisión: ${{commissionAmount}} MXN

La comisión será procesada pronto.

-- EasyOrder Partners`,
    variables: { name: "Nombre del partner", businessName: "Nombre del negocio", totalValue: "Valor total", commissionAmount: "Monto de comisión", actionUrl: "URL de comisiones" },
  },
  {
    name: "commission_approved",
    subject: "✅ Comisión Aprobada: ${{amount}} MXN",
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header">
    <h1>✅ Comisión Aprobada</h1>
  </div>
  <div class="content">
    <p>Hola <strong>{{name}}</strong>,</p>
    <h2>Tu comisión ha sido aprobada</h2>
    <div class="highlight">
      <p style="font-size: 24px; color: #FF8C00; text-align: center;"><strong>${{amount}} MXN</strong></p>
    </div>
    <p>Esta comisión ha sido aprobada y será procesada para pago en el próximo ciclo de pagos.</p>
    <p>Te notificaremos cuando el pago haya sido depositado en tu cuenta.</p>
    <div style="text-align: center;">
      <a href="{{actionUrl}}" class="button">Ver Detalles</a>
    </div>
  </div>
  <div class="footer">
    <p>Este email fue enviado por EasyOrder Partners</p>
    <p>© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
  </div>
</body>
</html>
    `,
    textBody: `Comisión Aprobada

Hola {{name}},

Tu comisión de ${{amount}} MXN ha sido aprobada y será procesada para pago pronto.

-- EasyOrder Partners`,
    variables: { name: "Nombre del partner", amount: "Monto de la comisión", actionUrl: "URL de comisiones" },
  },
  {
    name: "commission_paid",
    subject: "💰 ¡Pago Realizado! ${{amount}} MXN",
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header">
    <h1>💰 ¡Pago Realizado!</h1>
  </div>
  <div class="content">
    <p>Hola <strong>{{name}}</strong>,</p>
    <h2>Tu comisión ha sido depositada</h2>
    <div class="highlight">
      <p style="font-size: 24px; color: #22c55e; text-align: center;"><strong>${{amount}} MXN</strong></p>
      {{#if paymentRef}}<p style="text-align: center; font-size: 13px; color: #666;">Referencia: {{paymentRef}}</p>{{/if}}
    </div>
    <p>El pago ha sido procesado y depositado en tu cuenta registrada.</p>
    <p>Gracias por ser parte del programa de partners de EasyOrder. ¡Sigue generando ingresos con nosotros!</p>
    <div style="text-align: center;">
      <a href="{{actionUrl}}" class="button">Ver Historial de Pagos</a>
    </div>
  </div>
  <div class="footer">
    <p>Este email fue enviado por EasyOrder Partners</p>
    <p>© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
  </div>
</body>
</html>
    `,
    textBody: `¡Pago Realizado!

Hola {{name}},

Tu comisión de ${{amount}} MXN ha sido depositada.
{{#if paymentRef}}Referencia: {{paymentRef}}{{/if}}

Gracias por ser parte de EasyOrder Partners.

-- EasyOrder Partners`,
    variables: { name: "Nombre del partner", amount: "Monto pagado", paymentRef: "Referencia de pago", actionUrl: "URL de comisiones" },
  },
  {
    name: "partner_approved",
    subject: "🚀 ¡Tu cuenta ha sido aprobada! - EasyOrder Partners",
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header">
    <h1>🚀 ¡Cuenta Aprobada!</h1>
  </div>
  <div class="content">
    <p>Hola <strong>{{name}}</strong>,</p>
    <h2>¡Felicidades! Tu cuenta de partner ha sido aprobada</h2>
    <p>Ya puedes comenzar a generar leads y ganar comisiones con EasyOrder.</p>
    <div class="highlight">
      <p><strong>Tu código de partner:</strong></p>
      <p class="code">{{code}}</p>
      <p style="margin-top: 15px;"><strong>Tu link de referido:</strong></p>
      <p style="word-break: break-all;"><a href="{{referralLink}}">{{referralLink}}</a></p>
    </div>
    <h3>🎯 Próximos pasos:</h3>
    <ol style="color: #666; line-height: 2;">
      <li>Completa los cursos de capacitación</li>
      <li>Descarga los materiales de marketing</li>
      <li>Comienza a compartir tu link de referido</li>
      <li>¡Genera tus primeros leads!</li>
    </ol>
    <div style="text-align: center;">
      <a href="{{actionUrl}}" class="button">Ir a mi Dashboard</a>
    </div>
  </div>
  <div class="footer">
    <p>Este email fue enviado por EasyOrder Partners</p>
    <p>© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
  </div>
</body>
</html>
    `,
    textBody: `¡Tu cuenta ha sido aprobada!

Hola {{name}},

¡Felicidades! Tu cuenta de partner ha sido aprobada. Ya puedes comenzar a generar leads y ganar comisiones.

Tu código de partner: {{code}}
Tu link de referido: {{referralLink}}

Próximos pasos:
1. Completa los cursos de capacitación
2. Descarga los materiales de marketing
3. Comienza a compartir tu link de referido
4. ¡Genera tus primeros leads!

-- EasyOrder Partners`,
    variables: { name: "Nombre del partner", code: "Código de partner", referralLink: "Link de referido", actionUrl: "URL del dashboard" },
  },
  {
    name: "tier_upgrade",
    subject: "⭐ ¡Subiste de nivel! Ahora eres {{newTier}}",
    htmlBody: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header">
    <h1>⭐ ¡Subiste de Nivel!</h1>
  </div>
  <div class="content">
    <p>Hola <strong>{{name}}</strong>,</p>
    <h2>¡Felicidades por tu ascenso!</h2>
    <p>Gracias a tu excelente desempeño, has subido de nivel en el programa de partners.</p>
    <div class="highlight">
      <p style="text-align: center;">
        <span style="color: #999; text-decoration: line-through;">{{oldTier}}</span>
        <span style="font-size: 24px; margin: 0 15px;">→</span>
        <span style="color: #FF8C00; font-size: 24px; font-weight: bold;">{{newTier}}</span>
      </p>
    </div>
    <div class="highlight">
      <p><strong>🎁 Beneficios de tu nuevo nivel:</strong></p>
      <p style="font-size: 18px; color: #FF8C00;">Nueva tasa de comisión: <strong>{{newCommissionRate}}%</strong></p>
    </div>
    <p>¡Sigue así! Entre más ventas generes, más beneficios obtendrás.</p>
    <div style="text-align: center;">
      <a href="{{actionUrl}}" class="button">Ver mi Progreso</a>
    </div>
  </div>
  <div class="footer">
    <p>Este email fue enviado por EasyOrder Partners</p>
    <p>© ${new Date().getFullYear()} EasyOrder. Todos los derechos reservados.</p>
  </div>
</body>
</html>
    `,
    textBody: `¡Subiste de Nivel!

Hola {{name}},

¡Felicidades! Has ascendido de {{oldTier}} a {{newTier}}.

Nueva tasa de comisión: {{newCommissionRate}}%

¡Sigue así!

-- EasyOrder Partners`,
    variables: { name: "Nombre del partner", oldTier: "Nivel anterior", newTier: "Nuevo nivel", newCommissionRate: "Nueva tasa de comisión", actionUrl: "URL del dashboard" },
  },
];

async function seed() {
  console.log("🌱 Iniciando seed de templates de email...\n");

  for (const template of templates) {
    try {
      const existing = await prisma.emailTemplate.findUnique({
        where: { name: template.name },
      });

      if (existing) {
        // Actualizar template existente
        await prisma.emailTemplate.update({
          where: { name: template.name },
          data: {
            subject: template.subject,
            htmlBody: template.htmlBody.trim(),
            textBody: template.textBody.trim(),
            variables: template.variables,
            isActive: true,
          },
        });
        console.log(`✅ Actualizado: ${template.name}`);
      } else {
        // Crear nuevo template
        await prisma.emailTemplate.create({
          data: {
            name: template.name,
            subject: template.subject,
            htmlBody: template.htmlBody.trim(),
            textBody: template.textBody.trim(),
            variables: template.variables,
            isActive: true,
          },
        });
        console.log(`✅ Creado: ${template.name}`);
      }
    } catch (error) {
      console.error(`❌ Error con template ${template.name}:`, error.message);
    }
  }

  console.log("\n🎉 Seed de templates completado!");
}

seed()
  .catch((e) => {
    console.error("Error en seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

