/**
 * Script de prueba para validar el encolamiento de trabajos.
 * 
 * Este script es temporal y se usa para verificar que las funciones
 * de encolamiento funcionan correctamente con Redis.
 * 
 * Uso: node src/queues/testEnqueue.js
 */

const {
  enqueueSDRCall,
  enqueueQualificationCall,
  getSDRQueueStats,
  getQualificationQueueStats,
} = require("./index");

async function testQueues() {
  console.log("[Test] Iniciando prueba de encolamiento...\n");

  try {
    // Datos de prueba para SDR
    const sdrJobData = {
      contactId: "test-contact-123",
      abTestContactId: "test-ab-contact-456",
      agentConfigId: "test-agent-config-789",
      establishmentData: {
        name: "Restaurante de Prueba",
        phone: "5551234567",
        address: "Calle Falsa 123",
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
      contactId: "test-contact-456",
      abTestContactId: "test-ab-contact-789",
      agentConfigId: "test-agent-config-012",
      establishmentData: {
        name: "Restaurante de Prueba 2",
        phone: "5559876543",
        address: "Avenida Siempre Viva 742",
      },
      decisionMakerData: {
        name: "Juan Pérez",
        position: "Gerente",
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

    process.exit(0);
  } catch (error) {
    console.error("\n[Test] Error durante la prueba:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Ejecutar prueba
testQueues();
