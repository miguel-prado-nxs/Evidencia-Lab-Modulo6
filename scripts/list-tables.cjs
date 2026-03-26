const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  console.log(JSON.stringify(tables, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
