const logger = require("../config/logger");
const axios = require("axios");

const BAILEYS_URL = process.env.BAILEYS_URL;
const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY;
const BAILEYS_FROM_PHONE = process.env.BAILEYS_FROM_PHONE; // Número de WhatsApp remitente fijo opcional

/**
 * Obtiene una sesión conectada aleatoria de Baileys
 * @returns {Promise<string|null>} Número de teléfono de una sesión conectada o null
 */
const getRandomConnectedSession = async () => {
  if (!BAILEYS_URL) return null;

  try {
    const response = await axios.get(`${BAILEYS_URL}/api/sessions`, {
      headers: {
        "X-API-KEY": BAILEYS_API_KEY || ""
      }
    });

    const sessionsArr = response.data?.data || response.data || [];

    if (!Array.isArray(sessionsArr) || sessionsArr.length === 0) {
      logger.warn("No connected sessions available in Baileys");
      return null;
    }

    // Seleccionar una sesión al azar
    const randomSession = sessionsArr[Math.floor(Math.random() * sessionsArr.length)];
    return randomSession.phoneNumber || randomSession.id;
  } catch (error) {
    logger.error("Error getting connected sessions from Baileys", {
      error: error.message,
      url: `${BAILEYS_URL}/api/sessions`
    });
    return null;
  }
};

/**
 * Envía un mensaje de WhatsApp vía el servicio Baileys
 * @param {object} params
 * @param {string} params.to - Número destino (ej: "523891087325")
 * @param {string} params.message - Texto del mensaje
 * @param {string} [params.mediaUrl] - URL de imagen/media a enviar
 * @param {string} [params.mediaType] - Tipo de media ("image", "video", "document")
 * @param {string} [params.from] - Número remitente (override de BAILEYS_FROM_PHONE)
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
const sendWhatsAppMessage = async ({ to, message, mediaUrl, mediaType, from }) => {
  if (!BAILEYS_URL) {
    logger.warn("BAILEYS_URL not configured — skipping WhatsApp send");
    return { success: false, error: "BAILEYS_URL not configured" };
  }

  let fromPhone = from || BAILEYS_FROM_PHONE;

  // Si no se proporcionó ni está configurado en env, buscar una sesión activa
  if (!fromPhone) {
    fromPhone = await getRandomConnectedSession();
    if (!fromPhone) {
      logger.error("No active WhatsApp sessions available to send message");
      return { success: false, error: "No active WhatsApp sessions available" };
    }
  }

  const payload = {
    to,
    message,
    from: fromPhone
  };

  // Si hay media, incluirla
  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaType = mediaType || "image";
  }

  try {
    logger.info("Sending WhatsApp message via Baileys", {
      to,
      from: fromPhone,
      hasMedia: !!mediaUrl,
    });

    const response = await fetch(`${BAILEYS_URL}/api/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": BAILEYS_API_KEY || "",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      logger.error("Baileys send failed", {
        status: response.status,
        error: data.error || "Unknown error",
        to,
      });
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    logger.info("WhatsApp message sent successfully", {
      to,
      messageId: data.data?.key?.id || null,
    });

    return { success: true, data: data.data };
  } catch (error) {
    logger.error("Error calling Baileys service", {
      error: error.message,
      url: `${BAILEYS_URL}/api/messages/send`,
      to,
    });
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendWhatsAppMessage,
  getRandomConnectedSession
};
