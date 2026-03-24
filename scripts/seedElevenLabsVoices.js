/**
 * Script para poblar la tabla elevenlabs_personalities con voces de ElevenLabs
 * Ejecutar: node scripts/seedElevenLabsVoices.js
 */
require('dotenv').config();
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fetchElevenLabsVoices() {
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    if (!ELEVENLABS_API_KEY) {
        throw new Error("ELEVENLABS_API_KEY no está configurada en el archivo .env.");
    }

    const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
        headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json'
        }
    });
    
    return response.data.voices || [];
}

async function seedVoices() {
    console.log('🎤 Obteniendo voces de ElevenLabs API...');
    
    const voices = await fetchElevenLabsVoices();
    console.log(`📋 Se encontraron ${voices.length} voces`);

    let created = 0;
    let skipped = 0;

    for (const voice of voices) {
        try {
            // Verificar si ya existe
            const existing = await prisma.elevenLabsPersonality.findFirst({
                where: { voiceId: voice.voice_id }
            });

            if (existing) {
                console.log(`⏭️  Saltando "${voice.name}" (ya existe)`);
                skipped++;
                continue;
            }

            await prisma.elevenLabsPersonality.create({
                data: {
                    name: voice.name,
                    voiceId: voice.voice_id,
                    agentId: null,
                    isActive: true
                }
            });

            console.log(`✅ Creada: "${voice.name}" (${voice.voice_id})`);
            created++;
        } catch (error) {
            // Si falla por nombre duplicado, intentar con sufijo
            if (error.code === 'P2002') {
                try {
                    await prisma.elevenLabsPersonality.create({
                        data: {
                            name: `${voice.name} (${voice.voice_id.slice(-4)})`,
                            voiceId: voice.voice_id,
                            agentId: null,
                            isActive: true
                        }
                    });
                    console.log(`✅ Creada con sufijo: "${voice.name}" (${voice.voice_id})`);
                    created++;
                } catch (e) {
                    console.error(`❌ Error creando "${voice.name}":`, e.message);
                }
            } else {
                console.error(`❌ Error creando "${voice.name}":`, error.message);
            }
        }
    }

    console.log(`\n📊 Resumen: ${created} creadas, ${skipped} saltadas`);
}

seedVoices()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
