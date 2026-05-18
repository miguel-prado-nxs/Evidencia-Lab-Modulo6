const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const templates = [
  {
    couponType: "PLUS30",
    name: "1 mes gratis Plan Plus",
    description: "1 mes gratis de EasyOrder Plus",
    scenarios: ["bant_high", "first_contact", "high_intent"],
    percentOff: 100,
    durationMonths: 1,
    messageTemplate: `¡Hola {{nombre}}! 👋

Fue un gusto platicar sobre {{negocio}}.
Como te comenté, te comparto un cupón especial de bienvenida:

🎁 1 mes gratis de EasyOrder Plus

Usa el código:
{{codigo}}

👉 Actívalo aquí: {{couponLink}}

Con esto puedes:
✅ Recibir pedidos por QR
✅ Usar el punto de venta
✅ Ver reportes y métricas en tiempo real
✅ Administrar varias sucursales

⏰ Válido por 48 horas

¿Dudas? Responde este mensaje y te ayudamos 🙌`,
    maxPerUser: 1,
    expiresHours: 48,
    validFor: ["new_users"],
    priority: 10
  },
  {
    couponType: "50OFF",
    name: "50% descuento primer mes",
    description: "50% de descuento en tu primer mes",
    scenarios: ["price_objection", "high_intent"],
    percentOff: 50,
    durationMonths: 1,
    messageTemplate: `Hola {{nombre}} 👋

Lo entiendo, muchos restaurantes empiezan con la misma duda.
Por eso te damos este cupón 👇

🎟 50% de descuento en tu primer mes
Código:
{{codigo}}

Actívalo aquí: {{couponLink}}

⏰ Válido por 48 horas`,
    maxPerUser: 1,
    expiresHours: 48,
    validFor: ["new_users"],
    priority: 8
  },
  {
    couponType: "TRIAL14",
    name: "+14 días de prueba",
    description: "14 días adicionales de prueba gratis",
    scenarios: ["trial_ending", "active_free_user"],
    trialDays: 14,
    messageTemplate: `Hola {{nombre}} 👋

Tu prueba gratuita del plan PLUS termina pronto ⏳
Para que sigas usando EasyOrder te dejamos:

🎁 14 días extra de prueba GRATIS

Código:
{{codigo}}

Actívalo aquí: {{couponLink}}

⏰ Válido por 48 horas`,
    maxPerUser: 1,
    expiresHours: 48,
    validFor: ["new_users", "trial_users"],
    priority: 7
  },
  {
    couponType: "UPGRADEPRO",
    name: "Upgrade a Pro",
    description: "Plan Pro al precio de Plus primer mes",
    scenarios: ["upgrade_interest", "multiple_branches"],
    percentOff: 50,
    durationMonths: 1,
    messageTemplate: `Hola {{nombre}} 👋

Perfecto, para eso el Plan Pro funciona muy bien.
Para probar te damos:

🎟 Upgrade a Pro al precio de Plus el primer mes

Código:
{{codigo}}

Actívalo aquí: {{couponLink}}

Con el Plan Pro tienes:
✅ Múltiples sucursales
✅ Reportes avanzados
✅ Integraciones con apps de entrega

⏰ Válido por 48 horas`,
    maxPerUser: 1,
    expiresHours: 48,
    validFor: ["upgrade"],
    priority: 9
  },
  {
    couponType: "REFER",
    name: "Cupón Referidos",
    description: "1 mes gratis para ambos",
    scenarios: ["referral"],
    percentOff: 100,
    durationMonths: 1,
    messageTemplate: `🎉 ¡Gracias por invitar a otro restaurante a EasyOrder!

Como recompensa te damos:

🎁 1 mes gratis de Plan Pro

Código:
{{codigo}}

Actívalo aquí: {{couponLink}}

⏰ Válido por 48 horas`,
    maxPerUser: 3,
    expiresHours: 48,
    validFor: ["active_users"],
    priority: 6
  },
  {
    couponType: "COMEBACK",
    name: "Recuperación Lead",
    description: "30% descuento primer mes",
    scenarios: ["abandoned_conversation", "cold_lead"],
    percentOff: 30,
    durationMonths: 1,
    messageTemplate: `Hola {{nombre}} 👋

Ayer preguntaste sobre EasyOrder para {{negocio}}.
Si lo activas hoy te damos:

🎟 30% de descuento en tu primer mes

Código:
{{codigo}}

Actívalo aquí: {{couponLink}}

⏰ Válido por 48 horas`,
    maxPerUser: 1,
    expiresHours: 48,
    validFor: ["new_users"],
    priority: 5
  }
];

async function main() {
  console.log("🌱 Seeding coupon templates...");

  for (const template of templates) {
    const existing = await prisma.couponTemplate.findUnique({
      where: { couponType: template.couponType }
    });

    if (existing) {
      console.log(`⚠️  Template ${template.couponType} already exists, updating...`);
      await prisma.couponTemplate.update({
        where: { couponType: template.couponType },
        data: template
      });
    } else {
      console.log(`✅ Creating template ${template.couponType}...`);
      await prisma.couponTemplate.create({
        data: template
      });
    }
  }

  console.log("✅ Coupon templates seeded successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Error seeding coupon templates:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
