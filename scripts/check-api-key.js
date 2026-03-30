const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const apiKey = "sdr_7jht0adywjd6sqt6gvibmzascrioyie7";
  const keyRecord = await prisma.apiKey.findUnique({
    where: { key: apiKey },
  });

  if (!keyRecord) {
    console.log("API Key NOT FOUND");
  } else {
    console.log("API Key FOUND:");
    console.log(JSON.stringify(keyRecord, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
