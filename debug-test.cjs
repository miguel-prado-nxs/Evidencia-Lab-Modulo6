const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const test = await prisma.abTest.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      variants: {
        include: {
          contacts: true,
          personality: true
        }
      }
    }
  });

  if (!test) { fs.writeFileSync('debug-output.txt', 'No tests found'); return; }

  let out = '';
  out += `\n=== Test: "${test.name}" (${test.id}) ===\n`;
  out += `Status: ${test.status} | Type: ${test.agentType}\n`;
  out += `Created: ${test.createdAt}\n`;
  out += `Started: ${test.startDate || 'NOT STARTED'}\n`;

  for (const variant of test.variants) {
    out += `\n--- Variant: ${variant.personality?.name || 'Unknown'} (${variant.id}) ---\n`;
    out += `  agentConfigId: ${variant.agentConfigId}\n`;
    out += `  voiceId: ${variant.voiceId}\n`;
    out += `  percentage: ${variant.percentage}%\n`;
    out += `  Contacts (${variant.contacts.length}):\n`;
    
    for (const contact of variant.contacts) {
      out += `    Contact ${contact.contactId}:\n`;
      out += `      status: ${contact.status}\n`;
      out += `      calledAt: ${contact.calledAt || 'NEVER'}\n`;
      out += `      result: ${contact.result || 'NONE'}\n`;
    }
  }

  fs.writeFileSync('debug-output.txt', out);
  console.log('Written to debug-output.txt');
}

main().catch(console.error).finally(() => prisma.$disconnect());
