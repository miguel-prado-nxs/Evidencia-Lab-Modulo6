const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
require('dotenv').config({ path: 'C:/Nexgen/easyorder-partners-api/.env' });

const prisma = new PrismaClient();

async function checkElevenLabsCall() {
  const lastTest = await prisma.abTest.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { variants: { include: { contacts: true } } }
  });

  const apiKey = process.env.ELEVENLABS_API_KEY;

  for (const v of lastTest.variants) {
    console.log(`--- Variant: ${v.voiceId} ---`);
    for (const c of v.contacts) {
      if (c.result) {
        const res = JSON.parse(c.result);
        const cid = res.conversationId || res.call_id;
        if (cid) {
          const r = await axios.get(`https://api.elevenlabs.io/v1/convai/conversations/${cid}`, {
            headers: { 'xi-api-key': apiKey }
          });
          const override = r.data.conversation_initiation_client_data?.conversation_config_override;
          console.log(`  Conv ${cid}: Override Voice = ${override?.tts?.voice_id || 'NONE'}`);
        }
      }
    }
  }
  process.exit(0);
}

checkElevenLabsCall();
