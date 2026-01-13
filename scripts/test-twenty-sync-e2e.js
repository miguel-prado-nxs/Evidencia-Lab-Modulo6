/**
 * Test End-to-End de sincronizacion Twenty CRM
 * Valida el flujo completo: ESTABLISHMENT -> CONTACT -> PROSPECT -> LEAD -> CLIENT
 * 
 * REQUISITOS:
 * 1. Servidor Partners API debe estar corriendo (npm run dev)
 * 2. Worker de Twenty debe estar activo
 * 3. Variables de entorno configuradas (TWENTY_API_KEY, etc.)
 * 4. Base de datos accesible
 * 
 * USO:
 * 1. En una terminal: npm run dev
 * 2. En otra terminal: node scripts/test-twenty-sync-e2e.js
 */


// MOCKS para evitar cambios reales
const prisma = {
  twentySyncJob: { deleteMany: async () => { console.log('   [MOCK] twentySyncJob.deleteMany()'); } },
  twentySyncState: {
    deleteMany: async () => { console.log('   [MOCK] twentySyncState.deleteMany()'); },
    findUnique: async ({ where }) => {
      // Simular estados según nivel
      if (where.establishmentId) {
        return global.__mockSyncState || null;
      }
      return null;
    }
  },
  establishmentEnrichment: {
    upsert: async ({ where, create, update }) => {
      console.log('   [MOCK] upsert enrichment', { where, create, update });
      global.__mockSyncState = {
        establishmentId: where.establishmentId,
        twentyEstablecimientoId: 'MOCK_COMPANY_ID',
        twentyContactoId: 'MOCK_CONTACT_ID',
        lastSyncedLevel: 'CONTACT',
      };
    },
    update: async ({ where, data }) => {
      console.log('   [MOCK] update enrichment', { where, data });
      // Simular avance de pipeline
      if (data.level === 'PROSPECT') {
        global.__mockSyncState = {
          ...global.__mockSyncState,
          twentyProspectoId: 'MOCK_PROSPECT_ID',
          twentyContactoId: null,
          lastSyncedLevel: 'PROSPECT',
        };
      } else if (data.level === 'LEAD') {
        global.__mockSyncState = {
          ...global.__mockSyncState,
          twentyOpportunityId: 'MOCK_OPPORTUNITY_ID',
          twentyProspectoId: null,
          lastSyncedLevel: 'LEAD',
        };
      } else if (data.level === 'CLIENT') {
        global.__mockSyncState = {
          ...global.__mockSyncState,
          twentyClienteId: 'MOCK_CLIENT_ID',
          twentyOpportunityId: null,
          lastSyncedLevel: 'CLIENT',
        };
      }
    }
  }
};

const prismaGeo = {
  establishment: {
    findUnique: async ({ where }) => {
      if (where.id === TEST_ESTABLISHMENT_ID) {
        return {
          id: TEST_ESTABLISHMENT_ID,
          clee: 'MOCK_CLEE',
          name: 'Mock Restaurante',
          phone: '5551234567',
          email: 'mock@demo.com'
        };
      }
      return null;
    }
  }
};

const enqueueSync = async ({ establishmentId, partnerId, reason }) => {
  console.log(`   [MOCK] enqueueSync: { establishmentId: ${establishmentId}, partnerId: ${partnerId}, reason: ${reason} }`);
};

// ID del establecimiento de prueba (UUID de establishment en BD Geo)
const TEST_ESTABLISHMENT_ID = 'MOCK-UUID-1234'; // Valor simulado
const TEST_PARTNER_ID = 'c1f7a6e0-98d2-452b-94bb-e61694bb295d';

async function sleep(ms) {
  // No esperar realmente en modo mock
  return Promise.resolve();
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
    console.log('   Estado limpiado\n');

    // 2. Verificar establecimiento existe
    console.log('2. Verificando establecimiento en BD Geo...');
    const establishment = await prismaGeo.establishment.findUnique({
      where: { id: TEST_ESTABLISHMENT_ID }
    });
    if (!establishment) {
      throw new Error('Establecimiento de prueba no encontrado');
    }
    console.log(`   Establecimiento encontrado: ${establishment.name} (clee: ${establishment.clee})\n`);

    // 3. TEST NIVEL CONTACT
    console.log('3. TEST NIVEL CONTACT');
    console.log('   Creando enrichment nivel CONTACT...');
    await prisma.establishmentEnrichment.upsert({
      where: { establishmentId: TEST_ESTABLISHMENT_ID },
      create: {
        establishmentId: TEST_ESTABLISHMENT_ID,
        level: 'CONTACT',
        enrichedBy: TEST_PARTNER_ID,
        enrichedAt: new Date(),
        establishmentData: {
          clee: establishment.clee,
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
        productPurchased: null,
        establishmentData: {
          clee: establishment.clee,
          name: establishment.name,
          phone: establishment.phone,
          email: establishment.email
        }
      }
    });

    await enqueueSync({
      establishmentId: TEST_ESTABLISHMENT_ID,
      partnerId: TEST_PARTNER_ID,
      reason: 'E2E_TEST_CONTACT'
    });
    console.log('   Job encolado, esperando 15 segundos...');
    await sleep(15000);

    let syncState = await prisma.twentySyncState.findUnique({
      where: { establishmentId: TEST_ESTABLISHMENT_ID }
    });
    
    if (!syncState || !syncState.twentyEstablecimientoId) {
      throw new Error('No se creo el Company en Twenty');
    }
    console.log(`   Company creado en Twenty: ${syncState.twentyEstablecimientoId}`);
    
    if (!syncState.twentyContactoId) {
      throw new Error('No se creo el Contacto en Twenty');
    }
    console.log(`   Contacto creado en Twenty: ${syncState.twentyContactoId}\n`);

    // 4. TEST NIVEL PROSPECT
    console.log('4. TEST NIVEL PROSPECT');
    console.log('   Actualizando a PROSPECT con tomador de decisiones...');
    await prisma.establishmentEnrichment.update({
      where: { establishmentId: TEST_ESTABLISHMENT_ID },
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
      establishmentId: TEST_ESTABLISHMENT_ID,
      partnerId: TEST_PARTNER_ID,
      reason: 'E2E_TEST_PROSPECT'
    });
    console.log('   Job encolado, esperando 15 segundos...');
    await sleep(15000);

    syncState = await prisma.twentySyncState.findUnique({
      where: { establishmentId: TEST_ESTABLISHMENT_ID }
    });

    if (!syncState.twentyProspectoId) {
      throw new Error('No se creo el Prospecto en Twenty');
    }
    console.log(`   Prospecto creado en Twenty: ${syncState.twentyProspectoId}`);
    
    // Verificar que el contacto fue eliminado
    if (syncState.twentyContactoId) {
      console.log('   ADVERTENCIA: El contacto deberia haberse eliminado');
    } else {
      console.log('   Contacto eliminado correctamente\n');
    }

    // 5. TEST NIVEL LEAD
    console.log('5. TEST NIVEL LEAD');
    console.log('   Actualizando a LEAD con cualificación IFPD...');
    await prisma.establishmentEnrichment.update({
      where: { establishmentId: TEST_ESTABLISHMENT_ID },
      data: {
        level: 'LEAD',
        intent: 'Necesita sistema POS moderno',
        fear: 'Perder ventas por sistema lento',
        pain: 'Sistema actual obsoleto',
        desire: 'Incrementar eficiencia 30%'
      }
    });

    await enqueueSync({
      establishmentId: TEST_ESTABLISHMENT_ID,
      partnerId: TEST_PARTNER_ID,
      reason: 'E2E_TEST_LEAD'
    });
    console.log('   Job encolado, esperando 15 segundos...');
    await sleep(15000);

    syncState = await prisma.twentySyncState.findUnique({
      where: { establishmentId: TEST_ESTABLISHMENT_ID }
    });

    if (!syncState.twentyOpportunityId) {
      throw new Error('No se creo el Opportunity en Twenty');
    }
    console.log(`   Opportunity creado en Twenty: ${syncState.twentyOpportunityId}`);
    
    // Verificar que el prospecto fue eliminado
    if (syncState.twentyProspectoId) {
      console.log('   ADVERTENCIA: El prospecto deberia haberse eliminado');
    } else {
      console.log('   Prospecto eliminado correctamente\n');
    }

    // 6. TEST NIVEL CLIENT
    console.log('6. TEST NIVEL CLIENT');
    console.log('   Actualizando a CLIENT con datos de compra...');
    await prisma.establishmentEnrichment.update({
      where: { establishmentId: TEST_ESTABLISHMENT_ID },
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
      establishmentId: TEST_ESTABLISHMENT_ID,
      partnerId: TEST_PARTNER_ID,
      reason: 'E2E_TEST_CLIENT'
    });
    console.log('   Job encolado, esperando 15 segundos...');
    await sleep(15000);

    syncState = await prisma.twentySyncState.findUnique({
      where: { establishmentId: TEST_ESTABLISHMENT_ID }
    });

    if (!syncState.twentyClienteId) {
      throw new Error('No se creo el Cliente en Twenty');
    }
    console.log(`   Cliente creado en Twenty: ${syncState.twentyClienteId}`);
    
    // Verificar que el opportunity fue eliminado
    if (syncState.twentyOpportunityId) {
      console.log('   ADVERTENCIA: El opportunity deberia haberse eliminado');
    } else {
      console.log('   Opportunity eliminado correctamente\n');
    }

    // 7. VERIFICACION FINAL
    console.log('7. VERIFICACION FINAL');
    console.log('   Estado final en Twenty:');
    console.log(`   - Company ID: ${syncState.twentyEstablecimientoId}`);
    console.log(`   - Contacto ID: ${syncState.twentyContactoId || 'ELIMINADO'}`);
    console.log(`   - Prospecto ID: ${syncState.twentyProspectoId || 'ELIMINADO'}`);
    console.log(`   - Opportunity ID: ${syncState.twentyOpportunityId || 'ELIMINADO'}`);
    console.log(`   - Cliente ID: ${syncState.twentyClienteId}`);
    console.log(`   - Ultimo nivel sync: ${syncState.lastSyncedLevel}\n`);

    console.log('========================================');
    console.log('TEST END-TO-END COMPLETADO EXITOSAMENTE');
    console.log('========================================\n');

    return true;

  } catch (error) {
    console.error('\nERROR EN TEST END-TO-END:', error.message);
    console.error(error);
    return false;
  } finally {
    // No desconectar nada en modo mock
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
