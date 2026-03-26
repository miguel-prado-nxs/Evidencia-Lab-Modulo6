const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function syncVoices() {
  const keys = [
    'sk_cb4db678eb835667cb0c9d7204da5433204639fd6301bf46',
    'sk_316aec8539012fd4242b6c8c67e39933af7ff29711851407'
  ];

  const allVoices = new Map();

  for (const key of keys) {
    try {
      console.log(`Fetching voices for key: ${key.substring(0, 10)}...`);
      const res = await axios.get('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': key }
      });
      
      for (const voice of res.data.voices) {
        allVoices.set(voice.voice_id, {
          name: voice.name,
          voiceId: voice.voice_id,
          isActive: true
        });
      }
    } catch (e) {
      console.error(`Error with key ${key.substring(0, 10)}:`, e.message);
    }
  }

  console.log(`Total unique voices found: ${allVoices.size}`);

  for (const [id, voice] of allVoices) {
    await prisma.elevenLabsPersonality.upsert({
      where: { voiceId: id },
      update: { 
        name: voice.name,
        isActive: true
      },
      create: {
        name: voice.name,
        voiceId: voice.voiceId,
        isActive: true
      }
    });
    console.log(`Synced: ${voice.name} (${id})`);
  }
}

syncVoices()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
