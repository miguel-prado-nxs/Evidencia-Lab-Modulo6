const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const c = await prisma.campaign.findFirst();
  console.log('Campaign fields:', Object.keys(c));
  const t = await prisma.couponTemplate.findFirst();
  console.log('CouponTemplate fields:', Object.keys(t || {}));
}

main().catch(console.error).finally(() => prisma.$disconnect());
