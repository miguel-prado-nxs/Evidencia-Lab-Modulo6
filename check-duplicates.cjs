const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDuplicates() {
  const contacts = await prisma.abTestContact.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  const map = {};
  contacts.forEach(c => {
    const key = `${c.abTestId}-${c.contactId}`;
    if (!map[key]) map[key] = [];
    map[key].push(c.abTestVariantId);
  });

  for (const key in map) {
    if (map[key].length > 1) {
      console.log(`DUPLICATE FOUND for ${key}: ${map[key].join(', ')}`);
    }
  }
  process.exit(0);
}

checkDuplicates();
