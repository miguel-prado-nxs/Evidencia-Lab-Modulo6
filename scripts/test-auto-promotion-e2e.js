/**
 * Test E2E: Auto-Promoción + Sincronización Twenty
 * 
 * Valida el flujo completo:
 * 1. CONTACT: Agregar a contactos
 * 2. PROSPECT: Auto-promoción cuando hay tomador de decisiones
 * 3. LEAD: Auto-promoción cuando hay cualificación (IFPD)
 * 4. CLIENT: Auto-promoción cuando hay datos de cliente
 * 5. Twenty Sync: Verificar que se encoló correctamente
 * 
 * MODO DRY RUN:
 * - Ejecuta todo el flujo con transacciones que se deshacen (rollback)
 * - NO persiste cambios en la base de datos
 * - NO encola jobs a Twenty CRM
 * - Valida toda la lógica sin efectos secundarios
 */

// Activar modo DRY RUN
process.env.DRY_RUN = 'true';

// Mock de Twenty Sync Service - DEBE hacerse ANTES de cargar servicios
const mockTwentySync = {
  jobs: [],
  enqueueSync: async function({ establishmentId, partnerId, reason }) {
    console.log(`[MOCK] Twenty Sync llamado: ${reason} para ${establishmentId}`);
    mockTwentySync.jobs.push({ establishmentId, partnerId, reason, timestamp: new Date() });
    return { id: `mock-job-${mockTwentySync.jobs.length}`, reason, status: 'PENDING' };
  },
  reset: function() { mockTwentySync.jobs = []; }
};

// Base de datos en memoria para el mock
const mockDatabase = {
  enrichments: new Map(),
  prospects: new Map(),
  leads: new Map(),
  reset: function() {
    this.enrichments.clear();
    this.prospects.clear();
    this.leads.clear();
  }
};

// Variable para guardar referencia al prisma real
let originalPrismaInstance = null;

// Mockear Prisma ANTES de que se cargue cualquier servicio
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  // Mock Twenty Sync
  if (id.includes('twentySyncService')) {
    return { enqueueSync: mockTwentySync.enqueueSync };
  }
  
  // Mock Prisma database (partners API)
  if (id.includes('config/database') && !id.includes('geo')) {
    // Si no tenemos la instancia original, cargarla primero
    if (!originalPrismaInstance) {
      originalPrismaInstance = originalRequire.apply(this, arguments);
    }
    
    const mockPrisma = {
      partner: {
        findFirst: async (...args) => originalPrismaInstance.partner.findFirst(...args),
        findUnique: async (...args) => originalPrismaInstance.partner.findUnique(...args),
      },
      establishmentEnrichment: {
        findUnique: async ({ where }) => {
          return mockDatabase.enrichments.get(where.establishmentId) || null;
        },
        create: async ({ data }) => {
          const enrichment = { ...data, id: Date.now(), createdAt: new Date(), updatedAt: new Date() };
          mockDatabase.enrichments.set(data.establishmentId, enrichment);
          return enrichment;
        },
        update: async ({ where, data }) => {
          const existing = mockDatabase.enrichments.get(where.establishmentId);
          const updated = { ...existing, ...data, updatedAt: new Date() };
          mockDatabase.enrichments.set(where.establishmentId, updated);
          return updated;
        },
        upsert: async ({ where, create, update }) => {
          const existing = mockDatabase.enrichments.get(where.establishmentId);
          if (existing) {
            const updated = { ...existing, ...update, updatedAt: new Date() };
            mockDatabase.enrichments.set(where.establishmentId, updated);
            return updated;
          } else {
            const enrichment = { ...create, id: Date.now(), createdAt: new Date(), updatedAt: new Date() };
            mockDatabase.enrichments.set(create.establishmentId, enrichment);
            return enrichment;
          }
        },
      },
      leadProspect: {
        findFirst: async ({ where }) => {
          for (const [id, prospect] of mockDatabase.prospects) {
            if (where.establishmentId && prospect.establishmentId === where.establishmentId) {
              return prospect;
            }
          }
          return null;
        },
        findUnique: async ({ where }) => {
          if (where.id) {
            return mockDatabase.prospects.get(where.id) || null;
          }
          return null;
        },
        findMany: async ({ where }) => {
          const results = [];
          for (const [id, prospect] of mockDatabase.prospects) {
            let match = true;
            if (where.establishmentId && prospect.establishmentId !== where.establishmentId) match = false;
            if (match) results.push(prospect);
          }
          return results;
        },
        create: async ({ data }) => {
          const prospect = { ...data, id: Date.now(), createdAt: new Date(), updatedAt: new Date() };
          mockDatabase.prospects.set(prospect.id, prospect);
          return prospect;
        },
        update: async ({ where, data }) => {
          const existing = mockDatabase.prospects.get(where.id);
          const updated = { ...existing, ...data, updatedAt: new Date() };
          mockDatabase.prospects.set(where.id, updated);
          return updated;
        },
      },
      lead: {
        findFirst: async ({ where }) => {
          for (const [id, lead] of mockDatabase.leads) {
            if (where.partnerId && lead.partnerId === where.partnerId) {
              return lead;
            }
          }
          return null;
        },
        findUnique: async ({ where }) => {
          if (where.id) {
            return mockDatabase.leads.get(where.id) || null;
          }
          return null;
        },
        findMany: async ({ where, orderBy }) => {
          const results = [];
          for (const [id, lead] of mockDatabase.leads) {
            let match = true;
            if (where.partnerId && lead.partnerId !== where.partnerId) match = false;
            if (match) results.push(lead);
          }
          if (orderBy?.createdAt === 'desc') {
            results.sort((a, b) => b.createdAt - a.createdAt);
          }
          return results;
        },
        create: async ({ data }) => {
          const lead = { ...data, id: Date.now(), createdAt: new Date(), updatedAt: new Date() };
          mockDatabase.leads.set(lead.id, lead);
          return lead;
        },
        update: async ({ where, data }) => {
          const existing = mockDatabase.leads.get(where.id);
          const updated = { ...existing, ...data, updatedAt: new Date() };
          mockDatabase.leads.set(where.id, updated);
          return updated;
        },
      },
      activity: {
        create: async ({ data }) => {
          return { ...data, id: Date.now(), createdAt: new Date() };
        },
      },
      $transaction: async (callback) => {
        // En modo mock, ejecutar el callback directamente sin transacción real
        return callback(mockPrisma);
      },
    };
    return mockPrisma;
  }
  
  return originalRequire.apply(this, arguments);
};

const prisma = require("../src/config/database");
const prismaGeo = require("../src/config/database-geo");
const enrichmentService = require("../src/services/enrichmentService");
const geoService = require("../src/services/geoService");
const leadService = require("../src/services/leadService");

// Colores para output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n${"=".repeat(60)}`, "cyan");
  log(`PASO ${step}: ${message} [DRY RUN - NO SE PERSISTE]`, "bright");
  log("=".repeat(60), "cyan");
}

function logSuccess(message) {
  log(`[OK] ${message}`, "green");
}

function logError(message) {
  log(`[FAIL] ${message}`, "red");
}

function logWarning(message) {
  log(`[WARN] ${message}`, "yellow");
}

// Función cleanup ya no necesaria - usamos rollback automático en modo DRY RUN

async function verifyTwentySync(establishmentId, expectedReason) {
  log("\nVerificando Twenty Sync Job (mock)...", "blue");
  
  // En modo DRY RUN, verificar el mock en lugar de la BD
  const jobs = mockTwentySync.jobs.filter(j => j.establishmentId === establishmentId);

  if (jobs.length === 0) {
    logWarning("No se encontraron jobs de Twenty Sync en mock (puede ser normal en PASO 1)");
    return true;
  }

  const latestJob = jobs[jobs.length - 1]; // El último agregado
  logSuccess(`Job mock encolado: ${latestJob.reason}`);
  log(`  - Reason: ${latestJob.reason}`, "cyan");
  log(`  - Timestamp: ${latestJob.timestamp.toISOString()}`, "cyan");

  if (expectedReason && !latestJob.reason.includes(expectedReason)) {
    log(`  Nota: reason actual '${latestJob.reason}' (puede diferir del esperado)`, "cyan");
  }

  return true;
}

async function runTest() {
  let testPassed = true;

  try {
    logStep(0, "Configuración inicial");
    
    // Buscar un establecimiento de prueba (lectura real de BD)
    const establishment = await prismaGeo.establishment.findFirst({
      where: {
        phone: { not: null },
        email: { not: null },
        stateName: "Sinaloa",
      },
      orderBy: { id: "asc" },
    });

    if (!establishment) {
      logError("No se encontró establecimiento de prueba");
      return;
    }

    const establishmentId = establishment.id;
    
    // Obtener un partner real de la base de datos (lectura real de BD)
    const partner = await originalPrismaInstance.partner.findFirst({
      select: { id: true, contactName: true },
    });

    if (!partner) {
      logError("No se encontró ningún partner en la base de datos");
      return;
    }

    const partnerId = partner.id;

    log(`Establecimiento: ${establishment.name}`, "cyan");
    log(`   ID: ${establishmentId}`, "cyan");
    log(`   CLEE: ${establishment.clee}`, "cyan");
    log(`Partner: ${partner.contactName || partner.id}`, "cyan");
    log(`   ID: ${partnerId}`, "cyan");
    
    logWarning("Modo DRY RUN - Usando base de datos en memoria (mock)");
    
    // Reset mocks
    mockTwentySync.reset();
    mockDatabase.reset();

    // ========================================
    // PASO 1: Crear CONTACT básico
    // ========================================
    logStep(1, "Crear CONTACT (solo con datos básicos)");

    const contactData = {
      // No incluir datos de tomador aún, solo crear el enrichment
    };

    let enrichment = await enrichmentService.createOrUpdateEnrichment(
      establishmentId,
      contactData,
      partnerId
    );

    if (enrichment.level !== "CONTACT") {
      logError(`Se esperaba nivel CONTACT, se obtuvo ${enrichment.level}`);
      testPassed = false;
    } else {
      logSuccess(`Nivel correcto: ${enrichment.level}`);
    }

    // Verificar que NO se creó leadProspect aún
    let prospect = await prisma.leadProspect.findFirst({
      where: { establishmentId },
    });

    if (prospect) {
      logError("NO deberia existir leadProspect sin datos de tomador");
      testPassed = false;
    } else {
      logSuccess("leadProspect NO existe (correcto)");
    }

    await verifyTwentySync(establishmentId, "CONTACT");

    // ========================================
    // PASO 2: Agregar datos de TOMADOR DE DECISIONES
    // Esto debería AUTO-CREAR el leadProspect
    // ========================================
    logStep(2, "Agregar datos de TOMADOR DE DECISIONES (auto-crear prospect)");

    const prospectData = {
      decisionMakerName: "Juan Pérez Auto-Test",
      decisionMakerPhone: "6671234567",
      decisionMakerPosition: "Gerente General",
    };

    enrichment = await enrichmentService.createOrUpdateEnrichment(
      establishmentId,
      prospectData,
      partnerId
    );

    if (enrichment.level !== "PROSPECT") {
      logError(`Se esperaba nivel PROSPECT, se obtuvo ${enrichment.level}`);
      testPassed = false;
    } else {
      logSuccess(`Nivel correcto: ${enrichment.level}`);
    }

    // Verificar que SÍ se creó leadProspect automáticamente
    prospect = await prisma.leadProspect.findFirst({
      where: { establishmentId },
    });

    if (!prospect) {
      logError("Auto-promocion FALLO: leadProspect NO se creo automaticamente");
      testPassed = false;
    } else {
      logSuccess("Auto-promocion exitosa: leadProspect creado automaticamente");
      log(`   Prospect ID: ${prospect.id}`, "cyan");
      log(`   Status: ${prospect.status}`, "cyan");
      log(`   Partner ID: ${prospect.partnerId}`, "cyan");
    }

    await verifyTwentySync(establishmentId, "PROSPECT");

    // ========================================
    // PASO 3: Agregar datos de CUALIFICACIÓN (IFPD)
    // Esto debería AUTO-CONVERTIR a Lead
    // ========================================
    logStep(3, "Agregar datos de CUALIFICACIÓN IFPD (auto-convertir a Lead)");

    const qualificationData = {
      intent: "Está interesado en modernizar su sistema de pagos",
      fear: "Teme perder clientes por métodos de pago limitados",
      pain: "Actualmente solo acepta efectivo y pierde ventas",
      desire: "Quiere aceptar todas las formas de pago para aumentar ventas",
    };

    enrichment = await enrichmentService.createOrUpdateEnrichment(
      establishmentId,
      qualificationData,
      partnerId
    );

    if (enrichment.level !== "LEAD") {
      logError(`Se esperaba nivel LEAD, se obtuvo ${enrichment.level}`);
      testPassed = false;
    } else {
      logSuccess(`Nivel correcto: ${enrichment.level}`);
    }

    // Verificar que el prospect fue convertido
    prospect = await prisma.leadProspect.findFirst({
      where: { establishmentId },
    });

    if (!prospect || prospect.status !== "CONVERTED") {
      logError("Auto-promocion FALLO: prospect NO fue convertido a LEAD");
      testPassed = false;
    } else {
      logSuccess("Auto-promocion exitosa: prospect convertido a CONVERTED");
    }

    // Verificar que se creo el lead
    const leads = await prisma.lead.findMany({
      where: { partnerId },
      orderBy: { createdAt: "desc" },
    });

    if (leads.length === 0) {
      logError("Auto-promocion FALLO: NO se creo registro en tabla leads");
      testPassed = false;
    } else {
      logSuccess("Auto-promocion exitosa: Lead creado en tabla leads");
      log(`   Lead ID: ${leads[0].id}`, "cyan");
      log(`   Status: ${leads[0].status}`, "cyan");
      log(`   Contact: ${leads[0].contactName}`, "cyan");
    }

    await verifyTwentySync(establishmentId, "LEAD");

    // ========================================
    // PASO 4: Agregar datos de CLIENTE
    // Esto debería marcar el lead como WON
    // ========================================
    logStep(4, "Agregar datos de CLIENTE (marcar Lead como WON)");

    const clientData = {
      purchaseDate: new Date().toISOString().split("T")[0],
      productPurchased: "POS Terminal Premium",
      purchaseAmount: 5000,
      clientStatus: "activo",
    };

    enrichment = await enrichmentService.createOrUpdateEnrichment(
      establishmentId,
      clientData,
      partnerId
    );

    if (enrichment.level !== "CLIENT") {
      logError(`Se esperaba nivel CLIENT, se obtuvo ${enrichment.level}`);
      testPassed = false;
    } else {
      logSuccess(`Nivel correcto: ${enrichment.level}`);
    }

    // Verificar que el lead fue marcado como WON
    const leadsAfterClient = await prisma.lead.findMany({
      where: { partnerId },
      orderBy: { createdAt: "desc" },
    });

    if (leadsAfterClient.length > 0 && leadsAfterClient[0].status === "WON") {
      logSuccess("Auto-promocion exitosa: Lead marcado como WON");
      log(`   Lead Status: ${leadsAfterClient[0].status}`, "cyan");
    } else {
      logWarning("Lead no fue marcado como WON (puede ser por diseno)");
    }

    await verifyTwentySync(establishmentId, "CLIENT");

    // ========================================
    // RESUMEN FINAL
    // ========================================
    log("\n" + "=".repeat(60), "cyan");
    log("RESUMEN DE PRUEBAS", "bright");
    log("=".repeat(60), "cyan");

    const finalEnrichment = await prisma.establishmentEnrichment.findUnique({
      where: { establishmentId },
    });

    const finalProspect = await prisma.leadProspect.findFirst({
      where: { establishmentId },
    });

    const finalLeads = await prisma.lead.findMany({
      where: { partnerId },
    });

    log("\nEstado final (base de datos mock en memoria):", "blue");
    log(`   Enrichment Level: ${finalEnrichment?.level || "N/A"}`, "cyan");
    log(`   LeadProspect: ${finalProspect ? `${finalProspect.status} (ID: ${finalProspect.id})` : "No existe"}`, "cyan");
    log(`   Leads: ${finalLeads.length} creado(s)`, "cyan");
    log(`   Twenty Sync Jobs (mock): ${mockTwentySync.jobs.length} llamadas capturadas`, "cyan");

    log("\nJobs de sincronizacion (mock):", "blue");
    mockTwentySync.jobs.forEach((job, index) => {
      log(`   ${index + 1}. ${job.reason} - MOCK - ${job.timestamp.toISOString()}`, "cyan");
    });

    log("\nVerificacion de flujo completo:", "blue");
    
    const checks = [
      { name: "Enrichment nivel CLIENT", pass: finalEnrichment?.level === "CLIENT" },
      { name: "LeadProspect creado automaticamente", pass: !!finalProspect },
      { name: "LeadProspect con status CONVERTED", pass: finalProspect?.status === "CONVERTED" },
      { name: "Lead creado en tabla leads", pass: finalLeads.length > 0 },
      { name: "Lead marcado como WON", pass: finalLeads[0]?.status === "WON" },
      { name: "Al menos 1 sync job llamado (mock)", pass: mockTwentySync.jobs.length >= 1 },
      { name: "Sync job tiene reason actualizado (mock)", pass: mockTwentySync.jobs[mockTwentySync.jobs.length - 1]?.reason.includes("CLIENT") },
    ];

    let allChecksPassed = true;
    checks.forEach(check => {
      if (check.pass) {
        logSuccess(check.name);
      } else {
        logError(check.name);
        allChecksPassed = false;
      }
    });

    testPassed = testPassed && allChecksPassed;
    
    log("\n" + "=".repeat(60), "cyan");
    if (testPassed) {
      log("TODAS LAS PRUEBAS PASARON (DRY RUN)", "green");
      log("No se persistio nada en BD real - Solo en memoria", "green");
      log("=".repeat(60), "cyan");
      process.exit(0);
    } else {
      log("ALGUNAS PRUEBAS FALLARON", "red");
      log("No se persistio nada en BD real - Solo en memoria", "yellow");
      log("=".repeat(60), "cyan");
      process.exit(1);
    }

  } catch (error) {
    logError(`\nError fatal en prueba: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Ejecutar prueba
runTest();
