// Seed script para crear usuarios de prueba
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Iniciando seed de datos de prueba...\n");

  // ========================================
  // 1. Crear Usuario Admin
  // ========================================
  const adminPassword = await bcrypt.hash("Admin123!", 10);
  
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@easyorder.mx" },
    update: {},
    create: {
      id: uuidv4(),
      email: "admin@easyorder.mx",
      passwordHash: adminPassword,
      name: "Admin EasyOrder",
      role: "ADMIN",
      emailVerified: new Date(),
    },
  });
  console.log("✅ Usuario Admin creado:", adminUser.email);

  // ========================================
  // 2. Crear Usuario Partner de Prueba
  // ========================================
  const partnerPassword = await bcrypt.hash("Partner123!", 10);
  const partnerCode = "EO-TEST01";
  const referralLink = `https://easyorder.mx/?ref=${partnerCode}`;

  const partnerUser = await prisma.user.upsert({
    where: { email: "partner-test@easyorder.mx" },
    update: {},
    create: {
      id: uuidv4(),
      email: "partner-test@easyorder.mx",
      passwordHash: partnerPassword,
      name: "Partner de Prueba",
      role: "PARTNER",
      emailVerified: new Date(),
    },
  });
  console.log("✅ Usuario Partner creado:", partnerUser.email);

  // Crear perfil de Partner
  const partner = await prisma.partner.upsert({
    where: { userId: partnerUser.id },
    update: {},
    create: {
      id: uuidv4(),
      userId: partnerUser.id,
      code: partnerCode,
      type: "AFFILIATE",
      tier: "SILVER",
      status: "ACTIVE",
      companyName: "Test Company",
      phone: "+52 55 1234 5678",
      country: "MX",
      state: "CDMX",
      city: "Ciudad de México",
      commissionRate: 0.15,
      referralLink: referralLink,
      totalLeads: 10,
      totalDeals: 3,
      totalRevenue: 45000,
      totalCommission: 6750,
      approvedAt: new Date(),
    },
  });
  console.log("✅ Perfil Partner creado:", partner.code);

  // ========================================
  // 3. Crear Leads de Prueba
  // ========================================
  const leadStatuses = ["NEW", "CONTACTED", "QUALIFIED", "NEGOTIATION", "WON", "LOST"];
  const leads = [];

  for (let i = 1; i <= 10; i++) {
    const lead = await prisma.lead.create({
      data: {
        id: uuidv4(),
        partnerId: partner.id,
        businessName: `Restaurante Test ${i}`,
        contactName: `Contacto ${i}`,
        email: `lead${i}@test.com`,
        phone: `+52 55 ${1000 + i} ${2000 + i}`,
        businessType: i % 2 === 0 ? "Restaurante" : "Cafetería",
        location: "CDMX",
        monthlyOrders: i % 3 === 0 ? "500-1000" : "100-500",
        interests: ["POS", "Delivery"],
        status: leadStatuses[i % leadStatuses.length],
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "test-campaign",
        qualityScore: 50 + (i * 5),
        estimatedValue: 15000 + (i * 1000),
        estimatedMrr: 1500 + (i * 100),
      },
    });
    leads.push(lead);
  }
  console.log("✅ 10 Leads de prueba creados");

  // ========================================
  // 4. Crear Deals de Prueba
  // ========================================
  const wonLeads = leads.filter(l => l.status === "WON");
  
  for (const lead of wonLeads.slice(0, 3)) {
    const deal = await prisma.deal.create({
      data: {
        id: uuidv4(),
        partnerId: partner.id,
        leadId: lead.id,
        businessName: lead.businessName,
        planType: "growth",
        planPrice: 1499,
        setupFee: 2999,
        totalValue: 1499 * 12 + 2999,
        commissionRate: 0.15,
        commissionAmount: (1499 * 12 + 2999) * 0.15,
        status: "ACTIVE",
        closedAt: new Date(),
        activatedAt: new Date(),
      },
    });

    // Crear comisión por el deal
    await prisma.commission.create({
      data: {
        id: uuidv4(),
        partnerId: partner.id,
        dealId: deal.id,
        type: "SIGNUP_BONUS",
        amount: 500,
        currency: "MXN",
        status: "APPROVED",
      },
    });
  }
  console.log("✅ 3 Deals y comisiones de prueba creados");

  // ========================================
  // 5. Crear Activities de Prueba
  // ========================================
  const activityTypes = [
    "PARTNER_REGISTERED",
    "PARTNER_APPROVED",
    "LEAD_CREATED",
    "DEAL_CLOSED",
    "COMMISSION_EARNED",
  ];

  for (const type of activityTypes) {
    await prisma.activity.create({
      data: {
        id: uuidv4(),
        partnerId: partner.id,
        type: type,
        description: `Actividad de prueba: ${type}`,
        metadata: { test: true },
      },
    });
  }
  console.log("✅ 5 Activities de prueba creadas");

  // ========================================
  // 6. Crear API Key de Prueba
  // ========================================
  const apiKey = await prisma.apiKey.upsert({
    where: { key: "test-api-key-12345" },
    update: {},
    create: {
      id: uuidv4(),
      key: "test-api-key-12345",
      name: "Test API Key",
      description: "API Key para pruebas E2E",
      isActive: true,
    },
  });
  console.log("✅ API Key de prueba creada:", apiKey.key);

  // ========================================
  // 7. Crear Resources de Prueba
  // ========================================
  const resources = [
    {
      name: "Sales Deck 2024",
      description: "Presentación de ventas actualizada",
      category: "sales-deck",
      type: "pdf",
      url: "https://example.com/sales-deck.pdf",
      minTier: "REGISTERED",
      partnerTypes: ["AFFILIATE", "REFERRAL", "RESELLER"],
    },
    {
      name: "Email Templates",
      description: "Plantillas de email para prospectos",
      category: "email-template",
      type: "docx",
      url: "https://example.com/email-templates.docx",
      minTier: "SILVER",
      partnerTypes: ["AFFILIATE", "REFERRAL"],
    },
  ];

  for (const res of resources) {
    await prisma.resource.create({
      data: {
        id: uuidv4(),
        ...res,
      },
    });
  }
  console.log("✅ 2 Resources de prueba creados");

  console.log("\n🎉 Seed completado exitosamente!");
  console.log("\n📋 Credenciales de prueba:");
  console.log("   Admin: admin@easyorder.mx / Admin123!");
  console.log("   Partner: partner-test@easyorder.mx / Partner123!");
}

main()
  .catch((e) => {
    console.error("❌ Error en seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

