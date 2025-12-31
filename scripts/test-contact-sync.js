const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createJob() {
  const establishmentId = '10249326';
  
  let state = await prisma.twentySyncState.findUnique({ where: { establishmentId } });
  
  if (!state) {
    state = await prisma.twentySyncState.create({ data: { establishmentId } });
    console.log('State creado');
  }
  
  await prisma.twentySyncState.update({
    where: { establishmentId },
    data: { 
      twentyEstablecimientoId: null, 
      twentyContactoId: null, 
      lastSyncedLevel: null, 
      lastSyncedAt: null, 
      lastError: null 
    }
  });
  console.log('State limpiado');
  
  let job = await prisma.twentySyncJob.findFirst({ where: { establishmentId } });
  
  if (!job) {
    job = await prisma.twentySyncJob.create({
      data: { 
        establishmentId, 
        partnerId: '2c313852-5396-4e6b-890f-01438eaf0312', 
        reason: 'ADD_TO_CONTACTS', 
        status: 'PENDING', 
        nextRunAt: new Date() 
      }
    });
    console.log('Job creado:', job.id);
  }
  
  await prisma.twentySyncJob.update({
    where: { id: job.id },
    data: { 
      status: 'PENDING', 
      attempts: 0, 
      nextRunAt: new Date(), 
      completedAt: null, 
      lastError: null 
    }
  });
  console.log('Job listo:', job.id);
  
  await prisma.$disconnect();
}

createJob();
