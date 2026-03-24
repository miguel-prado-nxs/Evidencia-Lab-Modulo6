const logger = require("../config/logger");

const BAILEYS_SERVICE_URL = process.env.BAILEYS_SERVICE_URL;
const BAILEYS_API_KEY = process.env.BAILEYS_API_KEY;
const BAILEYS_FROM_PHONE = process.env.BAILEYS_FROM_PHONE; // Número de WhatsApp remitente (opcional, si no se envía, Baileys usa la primera sesión activa)

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
  if (!BAILEYS_SERVICE_URL) {
    logger.warn("BAILEYS_SERVICE_URL not configured — skipping WhatsApp send");
    return { success: false, error: "BAILEYS_SERVICE_URL not configured" };
  }

  const fromPhone = from || BAILEYS_FROM_PHONE;

  const payload = {
    to,
    message,
  };

  // Si hay un número remitente definido, incluirlo
  if (fromPhone) {
    payload.from = fromPhone;
  }

  // Si hay media, incluirla
  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaType = mediaType || "image";
  }

  try {
    logger.info("Sending WhatsApp message via Baileys", {
      to,
      from: fromPhone || "(auto)",
      hasMedia: !!mediaUrl,
    });

    const response = await fetch(`${BAILEYS_SERVICE_URL}/api/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": BAILEYS_API_KEY || "",
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
      url: `${BAILEYS_SERVICE_URL}/api/messages/send`,
      to,
    });
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendWhatsAppMessage,
};
