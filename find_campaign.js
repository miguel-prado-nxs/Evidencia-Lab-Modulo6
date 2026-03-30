const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const campaigns = await prisma.campaign.findMany({
    where: {
      couponTemplateIds: { isEmpty: false }
    },
    take: 1
  });

  if (campaigns.length > 0) {
    console.log(JSON.stringify(campaigns[0], null, 2));
  } else {
    console.log('No campaign with templates found');
  }
}

main().catch(err => console.error(err)).finally(() => prisma.$disconnect());
