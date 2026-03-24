/**
 * Test Call Controller
 * Controlador para manejar llamadas de prueba de configuraciones de agentes
 */

const logger = require("../config/logger");
const axios = require("axios");

const config = require("../config/env");

/**
 * POST /api/v1/test-call
 * Realiza una llamada de prueba usando la configuración del agente
 * 
 * @route POST /api/v1/test-call
 * @access Privado (requiere JWT)
 */
async function handleTestCall(req, res, next) {
    try {
        const { phone, message, model_settings } = req.body;

        // Validación básica
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: "phone es requerido",
            });
        }

        if (!message) {
            return res.status(400).json({
                success: false,
                error: "message es requerido",
            });
        }

        if (!model_settings) {
            return res.status(400).json({
                success: false,
                error: "model_settings es requerido",
            });
        }

        // Validar que el servicio ElevenLabs esté configurado
        const ELEVENLABS_SDR_URL = config.agents?.sdr?.url;
        if (!ELEVENLABS_SDR_URL) {
            logger.error("[Test Call] URL del agente de SDR no configurada en config.agents.sdr.url");
            return res.status(500).json({
                success: false,
                error: "Servicio de llamadas de agente no configurado",
            });
        }

        logger.info(`[Test Call] Iniciando llamada de prueba a ${phone}`, {
            userId: req.user?.id,
            voice: model_settings.voice,
        });

        // Payload adaptado para elevenlabs-sdr
        const payload = {
            establishment_id: `test-${Date.now()}`,
            establishment_name: "Llamada de Prueba",
            phone: phone,
            prospect_name: "Usuario de Prueba",
            agent_name: model_settings.personality_name || "Agente de Prueba",
            voice_id: model_settings.voice,
        };

        // Llamar al servicio externo de ElevenLabs SDR
        const endpoint = `${ELEVENLABS_SDR_URL}/api/sdr/initiate-call`;
        const response = await axios.post(endpoint, payload, {
            headers: {
                "Content-Type": "application/json",
            },
            timeout: 30000, // 30 segundos timeout
        });

        logger.info(`[Test Call] Llamada iniciada exitosamente para ${phone}`, {
            userId: req.user?.id,
            callSid: response.data?.call_sid,
        });

        return res.status(200).json({
            success: true,
            ...response.data,
        });

    } catch (error) {
        logger.error("[Test Call] Error al realizar llamada de prueba:", error);

        // Si es un error de Axios (del servicio externo)
        if (error.response) {
            return res.status(error.response.status).json({
                success: false,
                error: error.response.data?.error || "Error en el servicio de llamadas",
                details: error.response.data,
            });
        }

        // Si es un error de timeout o red
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({
                success: false,
                error: "Timeout al conectar con el servicio de llamadas",
            });
        }

        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({
                success: false,
                error: "Servicio de llamadas no disponible",
            });
        }

        // Error genérico
        next(error);
    }
}

module.exports = {
    handleTestCall,
};
