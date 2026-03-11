const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedCampaigns() {
  console.log('🌱 Seeding campaigns...');

  try {
    // Crear campaña de prueba 1: Campaña activa en CDMX
    const campaign1 = await prisma.campaign.upsert({
      where: { id: 'test-campaign-cdmx-1' },
      update: {},
      create: {
        id: 'test-campaign-cdmx-1',
        name: 'Promoción CDMX Centro - Febrero 2026',
        description: 'Campaña de promoción para restaurantes en el centro de CDMX con cupón de 2 meses gratis',
        status: 'ACTIVE',
        type: 'ACQUISITION',
        centerLat: 19.4326,
        centerLng: -99.1332,
        radiusMeters: 5000,
        activityCodes: ['722511', '722512', '722513'], // Códigos SCIAN de restaurantes
        employeeRanges: ['6-10', '11-30', '31-50'],
        filters: {
          city: 'CDMX',
          tags: ['restaurant', 'premium']
        },
        agentConfigId: 'agent-config-001',
        agentConfigName: 'Agente Ventas CDMX',
        offer: '+2 meses gratis en plan Premium',
        couponPrefix: 'CDMX2026',
        totalContacts: 50,
        totalCalled: 35,
        totalResponded: 20,
        totalConverted: 5,
        totalFailed: 3,
        couponsSent: 10,
        couponsVisited: 6,
        couponsConverted: 3,
        createdBy: 'admin-user-id',
        startedAt: new Date('2026-02-01'),
      }
    });

    // Crear campaña de prueba 2: Campaña en borrador
    const campaign2 = await prisma.campaign.upsert({
      where: { id: 'test-campaign-draft-1' },
      update: {},
      create: {
        id: 'test-campaign-draft-1',
        name: 'Campaña Guadalajara - Marzo 2026',
        description: 'Campaña planificada para zona metropolitana de Guadalajara',
        status: 'DRAFT',
        type: 'NURTURING',
        centerLat: 20.6597,
        centerLng: -103.3496,
        radiusMeters: 10000,
        activityCodes: ['722511', '722515'],
        employeeRanges: ['1-5', '6-10'],
        filters: {
          city: 'Guadalajara',
          minEmployees: 5
        },
        agentConfigId: 'agent-config-002',
        agentConfigName: 'Agente Nutrición GDL',
        offer: '15% descuento primer mes',
        couponPrefix: 'GDL2026',
        totalContacts: 0,
        totalCalled: 0,
        totalResponded: 0,
        totalConverted: 0,
        totalFailed: 0,
        couponsSent: 0,
        couponsVisited: 0,
        couponsConverted: 0,
        createdBy: 'admin-user-id',
      }
    });

    console.log(`✅ Created campaign: ${campaign1.name}`);
    console.log(`✅ Created campaign: ${campaign2.name}`);

    // Crear cupones para la campaña activa
    const coupons = [];
    for (let i = 1; i <= 10; i++) {
      const coupon = await prisma.campaignCoupon.upsert({
        where: { code: `CDMX2026-${i.toString().padStart(3, '0')}` },
        update: {},
        create: {
          code: `CDMX2026-${i.toString().padStart(3, '0')}`,
          campaignId: campaign1.id,
          offer: '+2 meses gratis en plan Premium',
          status: i <= 5 ? 'SENT' : 'GENERATED',
          sentAt: i <= 5 ? new Date() : null,
          visitedAt: i <= 2 ? new Date() : null,
          visitCount: i <= 2 ? Math.floor(Math.random() * 3) + 1 : 0,
        }
      });
      coupons.push(coupon);
    }

    console.log(`✅ Created ${coupons.length} coupons for campaign: ${campaign1.name}`);

    // Crear contactos de prueba para la campaña activa
    const contacts = [];
    for (let i = 1; i <= 15; i++) {
      const statuses = ['PENDING', 'CALLING', 'CALLED', 'RESPONDED', 'SENT', 'VISITED', 'CONVERTED', 'FAILED'];
      const status = statuses[i % statuses.length];

      const contact = await prisma.campaignContact.upsert({
        where: {
          campaignId_establishmentId: {
            campaignId: campaign1.id,
            establishmentId: `test-establishment-${i}`
          }
        },
        update: {},
        create: {
          campaignId: campaign1.id,
          establishmentId: `test-establishment-${i}`,
          establishmentName: `Restaurante Test ${i}`,
          establishmentPhone: `52555${i.toString().padStart(7, '0')}`,
          establishmentData: {
            address: `Calle Test ${i}, CDMX`,
            category: 'restaurant',
            employees: Math.floor(Math.random() * 20) + 5
          },
          status: status,
          couponId: i <= 5 ? coupons[i - 1].id : null,
          sentAt: ['CALLED', 'RESPONDED', 'SENT', 'VISITED', 'CONVERTED'].includes(status) ? new Date() : null,
          visitedAt: ['VISITED', 'CONVERTED'].includes(status) ? new Date() : null,
          convertedAt: status === 'CONVERTED' ? new Date() : null,
          messageId: ['CALLED', 'RESPONDED', 'SENT', 'VISITED', 'CONVERTED'].includes(status) ? `whatsapp-msg-${i}` : null,
        }
      });
      contacts.push(contact);
    }

    console.log(`✅ Created ${contacts.length} contacts for campaign: ${campaign1.name}`);

    console.log('✅ Campaign seed completed successfully!');
  } catch (error) {
    console.error('❌ Error seeding campaigns:', error);
    throw error;
  }
}

seedCampaigns()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

module.exports = seedCampaigns;
