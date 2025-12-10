/**
 * Script para sembrar configuraciones por defecto en la base de datos
 * Ejecutar con: node prisma/seed-settings.js
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const defaultConfigs = [
  {
    key: "commission_rates",
    value: {
      AFFILIATE: 0.1,
      REFERRAL: 0.08,
      RESELLER: 0.15,
      SOLUTIONS: 0.12,
      TECHNOLOGY: 0.08,
    },
    description: "Tasas de comisión base por tipo de partner",
  },
  {
    key: "tier_bonuses",
    value: {
      SILVER: 0.05,
      GOLD: 0.1,
      ELITE: 0.15,
    },
    description: "Bonificaciones adicionales por nivel de partner",
  },
  {
    key: "tier_requirements",
    value: {
      SILVER: { deals: 5, revenue: 50000 },
      GOLD: { deals: 15, revenue: 150000 },
      ELITE: { deals: 30, revenue: 500000 },
    },
    description: "Requisitos mínimos para subir de nivel",
  },
  {
    key: "notification_settings",
    value: {
      LEAD_NEW: { email: true, push: true },
      LEAD_STATUS_CHANGED: { email: true, push: true },
      DEAL_CLOSED: { email: true, push: true },
      COMMISSION_APPROVED: { email: true, push: true },
      COMMISSION_PAID: { email: true, push: true },
      PARTNER_APPROVED: { email: true, push: false },
      PARTNER_TIER_UPGRADE: { email: true, push: true },
      SYSTEM: { email: true, push: false },
    },
    description: "Configuración de canales de notificación por tipo",
  },
  {
    key: "program_info",
    value: {
      name: "EasyOrder Partners",
      logoUrl: "/EasyOrder.png",
      supportEmail: "partners@easyorder.mx",
      referralBaseUrl: "https://easyorder.mx/?ref=",
      termsUrl: "https://easyorder.mx/terminos",
      privacyUrl: "https://easyorder.mx/privacidad",
    },
    description: "Información general del programa de partners",
  },
];

async function seedSettings() {
  console.log("🌱 Iniciando seed de configuraciones...\n");

  for (const config of defaultConfigs) {
    try {
      const existing = await prisma.programConfig.findUnique({
        where: { key: config.key },
      });

      if (existing) {
        console.log(`⏭️  Config '${config.key}' ya existe, saltando...`);
      } else {
        await prisma.programConfig.create({
          data: {
            key: config.key,
            value: config.value,
            description: config.description,
          },
        });
        console.log(`✅ Config '${config.key}' creada`);
      }
    } catch (error) {
      console.error(`❌ Error creando config '${config.key}':`, error.message);
    }
  }

  console.log("\n🎉 Seed de configuraciones completado!");
}

// Ejecutar
seedSettings()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

