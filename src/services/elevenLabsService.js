const axios = require('axios');
const logger = require('../config/logger');
const prisma = require("../config/database");

/**
 * Obtiene la lista de agentes configurados en ElevenLabs
 * (Sigue funcionando como proxy directo por ahora)
 */
async function getAgents() {
    try {
        const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
        if (!ELEVENLABS_API_KEY) {
            throw new Error("ELEVENLABS_API_KEY no está configurada en el archivo .env.");
        }

        const response = await axios.get('https://api.elevenlabs.io/v1/convai/agents', {
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
                'Content-Type': 'application/json'
            }
        });
        
        return response.data.agents || [];
    } catch (error) {
        logger.error('[ElevenLabs Service] Error fetching agents:', error.message);
        throw error;
    }
}

/**
 * Obtiene la lista de voces disponibles (PERSONALIDADES) desde la BASE DE DATOS.
 * Esto centraliza el catálogo y evita errores de escritura manual.
 */
async function getVoices() {
    try {
        const personalities = await prisma.elevenLabsPersonality.findMany({
            where: {
                isActive: true
            },
            orderBy: {
                name: 'asc'
            }
        });
        
        // Mapear al formato que espera el frontend (Idéntico a la API de ElevenLabs)
        return personalities.map(p => ({
            voice_id: p.voiceId,
            name: p.name,
            agent_id: p.agentId
        }));
    } catch (error) {
        logger.error('[ElevenLabs Service] Error fetching voices from database:', error.message);
        // Fallback: Si falla la base de datos por alguna razón, podríamos reintentar con la API real
        // pero el requerimiento es usar la base.
        throw error;
    }
}

module.exports = {
    getAgents,
    getVoices
};
