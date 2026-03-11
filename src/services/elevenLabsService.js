const axios = require('axios');
const logger = require('../config/logger');

// La API Key se lee dentro de las funciones para mayor robustez

/**
 * Obtiene la lista de agentes configurados en ElevenLabs
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
 * Obtiene la lista de voces disponibles en ElevenLabs (premade, cloned, generated)
 */
async function getVoices() {
    try {
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
    } catch (error) {
        logger.error('[ElevenLabs Service] Error fetching voices:', error.message);
        throw error;
    }
}

module.exports = {
    getAgents,
    getVoices
};
