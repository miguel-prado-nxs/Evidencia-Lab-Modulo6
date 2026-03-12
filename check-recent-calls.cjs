const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRecentCalls() {
  console.log("--- Recent SDR Interactions ---");
  const sdrInteractions = await prisma.sdrInteraction.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(sdrInteractions, null, 2));

  console.log("\n--- Recent Call Leads ---");
  const callLeads = await prisma.callLead.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(callLeads, null, 2));

  process.exit(0);
}

checkRecentCalls();
