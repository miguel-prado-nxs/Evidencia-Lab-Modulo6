const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function findContact() {
  const cid = "conv_5901kkhm6q3ce2dtvx81047hg3cb";
  const contacts = await prisma.abTestContact.findMany({
    where: {
      result: {
        contains: cid
      }
    },
    include: {
      variant: true
    }
  });

  console.log(`Found ${contacts.length} contacts for Conv ${cid}`);
  contacts.forEach(c => {
    console.log(`Contact ${c.contactId}: Variant Voice ID = ${c.variant.voiceId}`);
  });
  process.exit(0);
}

findContact();
