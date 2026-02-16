/**
 * Script de prueba para validar el funcionamiento de los workers.
 *
 * Este script:
 * 1. Crea registros de prueba en la BD (AbTest, AbTestVariant, AbTestContact)
 * 2. Encola trabajos en ambas colas (SDR y Calificación)
 * 3. Monitorea el progreso de los jobs
 * 4. Verifica que los workers los procesen correctamente
 * 5. Limpia los datos de prueba al finalizar
 *
 * IMPORTANTE: Los workers deben estar corriendo en otro proceso
 * (ejecutar: npm run start:workers)
 *
 * Uso:
 *   npm run test:workers
 */

const { enqueueSDRCall, getSDRQueueStats } = require("./sdrCallQueue");
const {
  enqueueQualificationCall,
  getQualificationQueueStats,
} = require("./qualificationCallQueue");
const logger = require("../config/logger");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Función para esperar un tiempo específico
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testWorkers() {
  try {
    logger.info("[Test Workers] Iniciando prueba de workers...");

    // Crear datos de prueba en BD
    logger.info("[Test Workers] Creando datos de prueba en BD...");
    
    const abTest = await prisma.abTest.create({
      data: {
        name: "Test de Workers",
        description: "Test automático para validar procesamiento de workers",
        agentType: "SDR",
        status: "RUNNING",
      },
    });
    logger.info("[Test Workers] Test A/B creado", { testId: abTest.id });

    // Crear variante
    const variant = await prisma.abTestVariant.create({
      data: {
        abTestId: abTest.id,
        agentConfigId: "test-agent-config-workers-001",
        agentConfigName: "Agente de Prueba Workers",
        voiceId: "test-voice",
        percentage: 100,
      },
    });
    logger.info("[Test Workers] Variante creada", { variantId: variant.id });

    // Crear contactos en BD
    const sdrContact = await prisma.abTestContact.create({
      data: {
        abTestVariantId: variant.id,
        contactId: "test-contact-sdr-001",
        contactType: "ESTABLISHMENT",
        status: "PENDING",
      },
    });
    logger.info("[Test Workers] Contacto SDR creado", { contactId: sdrContact.id });

    const qualContact = await prisma.abTestContact.create({
      data: {
        abTestVariantId: variant.id,
        contactId: "test-contact-qual-001",
        contactType: "ESTABLISHMENT",
        status: "PENDING",
      },
    });
    logger.info("[Test Workers] Contacto Qualification creado", { contactId: qualContact.id });

    // Datos de prueba para SDR
    const sdrTestData = {
      contactId: sdrContact.contactId,
      abTestContactId: sdrContact.id,
      agentConfigId: variant.agentConfigId,
      establishmentData: {
        name: "Restaurante de Prueba SDR",
        phone: "6672398415",
        address: "Calle Prueba 123",
        city: "Ciudad de México",
        state: "CDMX",
      },
    };

    // Datos de prueba para Calificación
    const qualificationTestData = {
      contactId: qualContact.contactId,
      abTestContactId: qualContact.id,
      agentConfigId: variant.agentConfigId,
      establishmentData: {
        name: "Restaurante de Prueba Calificación",
        phone: "6674044517",
        address: "Avenida Prueba 456",
        city: "Guadalajara",
        state: "Jalisco",
      },
      decisionMakerData: {
        name: "Juan Pérez",
        position: "Gerente",
      },
    };

    // Encolar trabajos de prueba
    logger.info("[Test Workers] Encolando trabajos de prueba...");

    const sdrJob = await enqueueSDRCall(sdrTestData);
    logger.info("[Test Workers] Job SDR encolado", { jobId: sdrJob.id });

    const qualJob = await enqueueQualificationCall(qualificationTestData);
    logger.info("[Test Workers] Job Calificación encolado", { jobId: qualJob.id });

    // Monitorear el progreso cada 5 segundos durante 2 minutos
    const iterations = 24; // 24 x 5 segundos = 2 minutos
    let sdrCompleted = false;
    let qualCompleted = false;

    logger.info("[Test Workers] Monitoreando progreso de los jobs...");
    logger.info(
      "[Test Workers] NOTA: Asegúrate de que los workers estén corriendo (npm run start:workers)"
    );

    for (let i = 0; i < iterations; i++) {
      await delay(5000); // Esperar 5 segundos

      // Obtener estadísticas
      const sdrStats = await getSDRQueueStats();
      const qualStats = await getQualificationQueueStats();

      logger.info(`[Test Workers] Iteración ${i + 1}/${iterations}`, {
        sdr: sdrStats,
        qualification: qualStats,
      });

      // Verificar si los jobs fueron completados
      if (!sdrCompleted && sdrStats.completed > 0) {
        sdrCompleted = true;
        logger.info("[Test Workers] Job SDR completado exitosamente");
      }

      if (!qualCompleted && qualStats.completed > 0) {
        qualCompleted = true;
        logger.info("[Test Workers] Job Calificación completado exitosamente");
      }

      // Si ambos jobs están completados, terminar
      if (sdrCompleted && qualCompleted) {
        logger.info("[Test Workers] Todos los jobs fueron procesados exitosamente");
        break;
      }
    }

    // Verificar resultados finales
    const finalSDRStats = await getSDRQueueStats();
    const finalQualStats = await getQualificationQueueStats();

    logger.info("[Test Workers] Estadísticas finales", {
      sdr: finalSDRStats,
      qualification: finalQualStats,
    });

    // Limpiar datos de prueba
    logger.info("[Test Workers] Limpiando datos de prueba...");
    await prisma.abTestContact.deleteMany({
      where: { abTestVariantId: variant.id },
    });
    await prisma.abTestVariant.delete({
      where: { id: variant.id },
    });
    await prisma.abTest.delete({
      where: { id: abTest.id },
    });

    await prisma.$disconnect();

    if (sdrCompleted && qualCompleted) {
      logger.info("[Test Workers] PRUEBA EXITOSA: Todos los workers funcionan correctamente");
      process.exit(0);
    } else {
      logger.warn("[Test Workers] ADVERTENCIA: Algunos jobs no fueron procesados");
      logger.warn("[Test Workers] Verifica que los workers estén corriendo");

      if (!sdrCompleted) {
        logger.warn("[Test Workers] Job SDR no fue procesado");
      }

      if (!qualCompleted) {
        logger.warn("[Test Workers] Job Calificación no fue procesado");
      }

      process.exit(1);
    }
  } catch (error) {
    logger.error("[Test Workers] Error durante la prueba:", {
      error: error.message,
      stack: error.stack,
    });
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Ejecutar test
testWorkers();
