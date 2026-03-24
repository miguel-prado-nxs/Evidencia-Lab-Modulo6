const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const voices = [
    { name: "Roger", voiceId: "CwhRBWXzGAHq8TQ4Fs17" },
    { name: "Sarah", voiceId: "EXAVITQu4vr4xnSDxMaL" },
    { name: "Laura", voiceId: "FGY2WhTYpPnrIDTdsKH5" },
    { name: "Charlie", voiceId: "IKne3meq5aSn9XLyUdCD" },
    { name: "George", voiceId: "JBFqnCBsd6RMkjVDRZzb" },
    { name: "Callum", voiceId: "N2lVS1w4EtoT3dr4eOWO" },
    { name: "River", voiceId: "SAz9YHcvj6GT2YYXdXww" },
    { name: "Harry", voiceId: "SOYHLrjzK2X1ezoPC6cr" },
    { name: "Liam", voiceId: "TX3LPaxmHKxFdv7VOQHJ" },
    { name: "Alice", voiceId: "Xb7hH8MSUJpSbSDYk0k2" },
    { name: "Matilda", voiceId: "XrExE9yKIg1WjnnlVkGX" },
    { name: "Will", voiceId: "bIHbv24MWmeRgasZH58o" },
    { name: "Jessica", voiceId: "cgSgspJ2msm6clMCkdW9" },
    { name: "Eric", voiceId: "cjVigY5qzO86Huf0OWal" },
    { name: "Bella", voiceId: "hpp4J3VqNfWAUOO0d1Us" },
    { name: "Chris", voiceId: "iP95p4xoKVk53GoZ742B" },
    { name: "Brian", voiceId: "nPczCjzI2devNBz1zQrb" },
    { name: "Daniel", voiceId: "onwK4e9ZLuTAKqWW03F9" },
    { name: "Lily", voiceId: "pFZP5JQG7iQjIQuC4Bku" },
    { name: "Adam", voiceId: "pNInz6obpgDQGcFmaJgB" },
    { name: "Bill", voiceId: "pqHfZKP75CvOlQylNhV4" },
    { name: "Esteban", voiceId: "dWuRxmMbMNqQv2k7lBO2", agentId: "agent_8001kjdzt8xsf428pdwr6dasb3x6" },
    { name: "Est-Camsilv", voiceId: "J6ozLk7jRgXAL6M3Sczp", agentId: "agent_8001kjdzt8xsf428pdwr6dasb3x6" },
    { name: "Kaylee Quintero", voiceId: "Nmq9rzTULj5tCftrsoGv", agentId: "agent_8001kjdzt8xsf428pdwr6dasb3x6" },
    { name: "Lluvia Barceló", voiceId: "Gn8G7b5xJW19WnY3tKw4", agentId: "agent_8001kjdzt8xsf428pdwr6dasb3x6" },
    { name: "Cano", voiceId: "gsPeK1qQrfiqjkbnquQ7", agentId: "agent_8001kjdzt8xsf428pdwr6dasb3x6" },
    { name: "Antonio Zamora", voiceId: "XtQBugM2Fo3MVfTjamTz", agentId: "agent_8001kjdzt8xsf428pdwr6dasb3x6" },
    { name: "Celeste", voiceId: "KIaGEdP18b1n3J4J16D9", agentId: "agent_8001kjdzt8xsf428pdwr6dasb3x6" },
    { name: "Carlos Guerrero", voiceId: "M5mO7w4UKHD72o28ofQY", agentId: "agent_8001kjdzt8xsf428pdwr6dasb3x6" },
    { name: "Leslie Guzman", voiceId: "BrdXeso1UtycxR7Yy07k", agentId: "agent_8001kjdzt8xsf428pdwr6dasb3x6" },
    { name: "Geraldine Samano", voiceId: "leK1TEBpggWE8znofhWY", agentId: "agent_8001kjdzt8xsf428pdwr6dasb3x6" }
  ];

  for (const v of voices) {
    await prisma.elevenLabsPersonality.upsert({
      where: { name: v.name },
      update: { voiceId: v.voiceId, agentId: v.agentId || null },
      create: {
        name: v.name,
        voiceId: v.voiceId,
        agentId: v.agentId || null
      }
    });
    console.log(`Upserted voice: ${v.name}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
