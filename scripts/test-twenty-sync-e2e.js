/**
 * Test End-to-End de sincronización Twenty CRM
 * Valida el flujo completo: ESTABLISHMENT → CONTACT → PROSPECT → LEAD → CLIENT
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { PrismaClient: PrismaGeo } = require('../node_modules/.prisma/client-geo');
const prismaGeo = new PrismaGeo();
const { enqueueSync } = require('../src/services/twenty/twentySyncService');
const twentyService = require('../src/services/twenty/twentyService');

// ID del establecimiento de prueba
const TEST_ESTABLISHMENT_CLEE = '25006722514004391000000000U4';
const TEST_PARTNER_ID = 'c1f7a6e0-98d2-452b-94bb-e61694bb295d';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testE2E() {
  console.log('\n========================================');
  console.log('TEST END-TO-END: Sincronización Twenty CRM');
  console.log('========================================\n');

  try {
    // 1. PREPARACIÓN: Limpiar estado
    console.log('1. Limpiando estado previo...');
    await prisma.twentySyncJob.deleteMany({});
    await prisma.twentySyncState.deleteMany({});
    console.log('   ✓ Estado limpiado\n');

    // 2. Verificar establecimiento existe
    console.log('2. Verificando establecimiento en BD Geo...');
    const establishment = await prismaGeo.establishment.findFirst({
      where: { clee: TEST_ESTABLISHMENT_CLEE }
    });
    if (!establishment) {
      throw new Error('Establecimiento de prueba no encontrado');
    }
    console.log(`   ✓ Establecimiento encontrado: ${establishment.name}\n`);

    // 3. TEST NIVEL CONTACT
    console.log('3. TEST NIVEL CONTACT');
    console.log('   Creando enrichment nivel CONTACT...');
    await prisma.establishmentEnrichment.upsert({
      where: { establishmentId: TEST_ESTABLISHMENT_CLEE },
      create: {
        establishmentId: TEST_ESTABLISHMENT_CLEE,
        level: 'CONTACT',
        enrichedBy: TEST_PARTNER_ID,
        enrichedAt: new Date(),
        establishmentData: {
          name: establishment.name,
          phone: establishment.phone,
          email: establishment.email
        }
      },
      update: {
        level: 'CONTACT',
        decisionMakerName: null,
        decisionMakerPhone: null,
        decisionMakerEmail: null,
        intent: null,
        fear: null,
        pain: null,
        desire: null,
        purchaseDate: null,
        productPurchased: null
      }
    });

    await enqueueSync({
      establishmentId: TEST_ESTABLISHMENT_CLEE,
      partnerId: TEST_PARTNER_ID,
      reason: 'E2E_TEST_CONTACT'
    });
    console.log('   Job encolado, esperando 15 segundos...');
    await sleep(15000);

    let syncState = await prisma.twentySyncState.findUnique({
      where: { establishmentId: TEST_ESTABLISHMENT_CLEE }
    });
    
    if (!syncState || !syncState.twentyEstablecimientoId) {
      throw new Error('No se creó el Company en Twenty');
    }
    console.log(`   ✓ Company creado en Twenty: ${syncState.twentyEstablecimientoId}`);
    
    if (!syncState.twentyContactoId) {
      throw new Error('No se creó el Contacto en Twenty');
    }
    console.log(`   ✓ Contacto creado en Twenty: ${syncState.twentyContactoId}\n`);

    // 4. TEST NIVEL PROSPECT
    console.log('4. TEST NIVEL PROSPECT');
    console.log('   Actualizando a PROSPECT con tomador de decisiones...');
    await prisma.establishmentEnrichment.update({
      where: { establishmentId: TEST_ESTABLISHMENT_CLEE },
      data: {
        level: 'PROSPECT',
        decisionMakerName: 'Fabián Ibarra',
        decisionMakerPosition: 'dueño',
        decisionMakerPhone: '6674044517',
        decisionMakerEmail: 'fabianibaro@nexgen.mx',
        decisionMakerWhatsApp: '6674044517'
      }
    });

    await enqueueSync({
      establishmentId: TEST_ESTABLISHMENT_CLEE,
      partnerId: TEST_PARTNER_ID,
      reason: 'E2E_TEST_PROSPECT'
    });
    console.log('   Job encolado, esperando 15 segundos...');
    await sleep(15000);

    syncState = await prisma.twentySyncState.findUnique({
      where: { establishmentId: TEST_ESTABLISHMENT_CLEE }
    });

    if (!syncState.twentyProspectoId) {
      throw new Error('No se creó el Prospecto en Twenty');
    }
    console.log(`   ✓ Prospecto creado en Twenty: ${syncState.twentyProspectoId}`);
    
    // Verificar que el contacto fue eliminado
    if (syncState.twentyContactoId) {
      console.log('   ⚠ ADVERTENCIA: El contacto debería haberse eliminado');
    } else {
      console.log('   ✓ Contacto eliminado correctamente\n');
    }

    // 5. TEST NIVEL LEAD
    console.log('5. TEST NIVEL LEAD');
    console.log('   Actualizando a LEAD con cualificación IFPD...');
    await prisma.establishmentEnrichment.update({
      where: { establishmentId: TEST_ESTABLISHMENT_CLEE },
      data: {
        level: 'LEAD',
        intent: 'Necesita sistema POS moderno',
        fear: 'Perder ventas por sistema lento',
        pain: 'Sistema actual obsoleto',
        desire: 'Incrementar eficiencia 30%'
      }
    });

    await enqueueSync({
      establishmentId: TEST_ESTABLISHMENT_CLEE,
      partnerId: TEST_PARTNER_ID,
      reason: 'E2E_TEST_LEAD'
    });
    console.log('   Job encolado, esperando 15 segundos...');
    await sleep(15000);

    syncState = await prisma.twentySyncState.findUnique({
      where: { establishmentId: TEST_ESTABLISHMENT_CLEE }
    });

    if (!syncState.twentyOpportunityId) {
      throw new Error('No se creó el Opportunity en Twenty');
    }
    console.log(`   ✓ Opportunity creado en Twenty: ${syncState.twentyOpportunityId}`);
    
    // Verificar que el prospecto fue eliminado
    if (syncState.twentyProspectoId) {
      console.log('   ⚠ ADVERTENCIA: El prospecto debería haberse eliminado');
    } else {
      console.log('   ✓ Prospecto eliminado correctamente\n');
    }

    // 6. TEST NIVEL CLIENT
    console.log('6. TEST NIVEL CLIENT');
    console.log('   Actualizando a CLIENT con datos de compra...');
    await prisma.establishmentEnrichment.update({
      where: { establishmentId: TEST_ESTABLISHMENT_CLEE },
      data: {
        level: 'CLIENT',
        purchaseDate: new Date(),
        productPurchased: 'Plan básico',
        purchaseAmount: 5000,
        clientSince: new Date(),
        clientStatus: 'ACTIVO',
        clientNotes: 'Cliente satisfecho con el servicio'
      }
    });

    await enqueueSync({
      establishmentId: TEST_ESTABLISHMENT_CLEE,
      partnerId: TEST_PARTNER_ID,
      reason: 'E2E_TEST_CLIENT'
    });
    console.log('   Job encolado, esperando 15 segundos...');
    await sleep(15000);

    syncState = await prisma.twentySyncState.findUnique({
      where: { establishmentId: TEST_ESTABLISHMENT_CLEE }
    });

    if (!syncState.twentyClienteId) {
      throw new Error('No se creó el Cliente en Twenty');
    }
    console.log(`   ✓ Cliente creado en Twenty: ${syncState.twentyClienteId}`);
    
    // Verificar que el opportunity fue eliminado
    if (syncState.twentyOpportunityId) {
      console.log('   ⚠ ADVERTENCIA: El opportunity debería haberse eliminado');
    } else {
      console.log('   ✓ Opportunity eliminado correctamente\n');
    }

    // 7. VERIFICACIÓN FINAL
    console.log('7. VERIFICACIÓN FINAL');
    console.log('   Estado final en Twenty:');
    console.log(`   - Company ID: ${syncState.twentyEstablecimientoId}`);
    console.log(`   - Contacto ID: ${syncState.twentyContactoId || 'ELIMINADO'}`);
    console.log(`   - Prospecto ID: ${syncState.twentyProspectoId || 'ELIMINADO'}`);
    console.log(`   - Opportunity ID: ${syncState.twentyOpportunityId || 'ELIMINADO'}`);
    console.log(`   - Cliente ID: ${syncState.twentyClienteId}`);
    console.log(`   - Último nivel sync: ${syncState.lastSyncedLevel}\n`);

    console.log('========================================');
    console.log('✓ TEST END-TO-END COMPLETADO EXITOSAMENTE');
    console.log('========================================\n');

    return true;

  } catch (error) {
    console.error('\n❌ ERROR EN TEST END-TO-END:', error.message);
    console.error(error);
    return false;
  } finally {
    await prisma.$disconnect();
    await prismaGeo.$disconnect();
  }
}

// Ejecutar test
testE2E()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
  });
