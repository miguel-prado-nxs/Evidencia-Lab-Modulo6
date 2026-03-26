const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function checkCampaign(id) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        _count: {
          select: { contacts: true }
        }
      }
    });

    if (!campaign) {
      console.log("No se encontró la campaña");
      return;
    }

    const contactsByStatus = await prisma.campaignContact.groupBy({
      by: ["status"],
      where: { campaignId: id },
      _count: { _all: true }
    });

    console.log("Campaña:", campaign.name, "(", campaign.status, ")");
    console.log("Total Contactos:", campaign._count.contacts);
    console.log("Estados de contactos:");
    contactsByStatus.forEach(group => {
      console.log(`- ${group.status}: ${group._count._all}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

const id = process.argv[2] || "3329ed6d-510a-4149-8593-cafdf1e75496";
checkCampaign(id);
