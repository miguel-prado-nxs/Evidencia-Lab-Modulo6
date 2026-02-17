/**
 * Script de prueba para validar el encolamiento de trabajos.
 * 
 * Este script crea registros temporales en la BD para simular un test A/B real,
 * luego encola los trabajos para que los workers los procesen.
 * 
 * IMPORTANTE: Solo encola jobs, no los procesa. Para procesarlos ejecuta:
 * npm run start:workers (en otro terminal)
 * 
 * Uso: node src/queues/testEnqueue.js
 */

const {
  enqueueSDRCall,
  enqueueQualificationCall,
  getSDRQueueStats,
  getQualificationQueueStats,
} = require("./index");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function testQueues() {
  console.log("[Test] Iniciando prueba de encolamiento...\n");

  try {
    // Crear un test A/B temporal
    console.log("[Test] Creando datos de prueba en BD...");
    
    const abTest = await prisma.abTest.create({
      data: {
        name: "Test de Encolamiento",
        description: "Test automatico para validar sistema de colas",
        agentType: "SDR",
        status: "RUNNING",
      },
    });
    console.log("[Test] Test A/B creado:", abTest.id);

    // Crear variante
    const variant = await prisma.abTestVariant.create({
      data: {
        abTestId: abTest.id,
        agentConfigId: "test-agent-config-789",
        agentConfigName: "Agente de Prueba",
        voiceId: "test-voice",
        percentage: 100,
      },
    });
    console.log("[Test] Variante creada:", variant.id);

    // Crear contactos en BD
    const sdrContact = await prisma.abTestContact.create({
      data: {
        abTestVariantId: variant.id,
        contactId: "test-contact-123",
        contactType: "ESTABLISHMENT",
        status: "PENDING",
      },
    });
    console.log("[Test] Contacto SDR creado:", sdrContact.id);

    const qualContact = await prisma.abTestContact.create({
      data: {
        abTestVariantId: variant.id,
        contactId: "test-contact-456",
        contactType: "ESTABLISHMENT",
        status: "PENDING",
      },
    });
    console.log("[Test] Contacto Qualification creado:", qualContact.id);

    console.log("\n[Test] Encolando jobs...\n");

    // Datos de prueba para SDR
    const sdrJobData = {
      contactId: sdrContact.contactId,
      abTestContactId: sdrContact.id,
      agentConfigId: variant.agentConfigId,
      establishmentData: {
        name: "Restaurante de Prueba",
        phone: "6672398415",
        address: "Calle Falsa 123, Culiacán, Sinaloa",
        employeeRange: "6 a 10 personas",
        agentConfigName: variant.agentConfigName,
      },
    };

    console.log("[Test] Encolando job SDR...");
    const sdrJob = await enqueueSDRCall(sdrJobData);
    console.log("[Test] Job SDR encolado exitosamente:", {
      id: sdrJob.id,
      name: sdrJob.name,
    });

    // Datos de prueba para Qualification
    const qualificationJobData = {
      contactId: qualContact.contactId,
      abTestContactId: qualContact.id,
      agentConfigId: variant.agentConfigId,
      establishmentData: {
        name: "Restaurante de Prueba 2",
        phone: "6674044517",
        address: "Avenida Siempre Viva 742, Guadalajara, Jalisco",
        employeeRange: "11 a 50 personas",
        agentConfigName: variant.agentConfigName,
      },
      decisionMakerData: {
        name: "Juan Pérez",
        position: "Gerente",
        email: "juan.perez@restaurante.com",
      },
    };

    console.log("\n[Test] Encolando job Qualification...");
    const qualificationJob = await enqueueQualificationCall(qualificationJobData);
    console.log("[Test] Job Qualification encolado exitosamente:", {
      id: qualificationJob.id,
      name: qualificationJob.name,
    });

    // Obtener estadísticas
    console.log("\n[Test] Obteniendo estadísticas de las colas...");
    const sdrStats = await getSDRQueueStats();
    const qualificationStats = await getQualificationQueueStats();

    console.log("\n[SDR Queue Stats]:", sdrStats);
    console.log("[Qualification Queue Stats]:", qualificationStats);

    console.log("\n[Test] Prueba completada exitosamente");
    console.log("[Test] Verifica el dashboard en: http://localhost:3004/admin/queues");
    console.log("\n[Test] NOTA: Para que los workers procesen estos jobs, ejecuta:");
    console.log("[Test]   npm run start:workers\n");

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error("\n[Test] Error durante la prueba:", error.message);
    console.error(error.stack);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Ejecutar prueba
testQueues();
