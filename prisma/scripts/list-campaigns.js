require('dotenv').config();
const prisma = require('../../src/config/database');

async function run() {
  const campaigns = await prisma.campaign.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      createdAt: true,
      _count: {
        select: {
          contacts: true,
          coupons: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.table(
    campaigns.map((c) => ({
      name: c.name,
      type: c.type,
      status: c.status,
      contacts: c._count.contacts,
      coupons: c._count.coupons,
      createdAt: c.createdAt.toISOString().split('T')[0],
      id: c.id,
    }))
  );

  await prisma.$disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });
