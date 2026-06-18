const config = require('../config/env');
const logger = require('../config/logger');

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB (límite de Cloudflare Images)

const validateImageFile = (buffer, mimeType) => {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(
      `Tipo de archivo no permitido: ${mimeType}. Solo se aceptan imágenes (JPEG, PNG, WebP, GIF, SVG).`
    );
  }
  if (buffer.length > MAX_SIZE_BYTES) {
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    throw new Error(`La imagen excede el máximo de 10MB (recibido: ${sizeMB}MB).`);
  }
};

/**
 * Sube una imagen a Cloudflare Images y retorna su URL pública.
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} mimeType
 * @returns {Promise<{ imageId: string, url: string }>}
 */
const uploadImage = async (buffer, filename, mimeType) => {
  const { accountId, imagesApiToken, defaultVariant } = config.cloudflare;

  if (!accountId || !imagesApiToken) {
    throw new Error(
      'Cloudflare Images no está configurado. Verifica CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_IMAGES_API_TOKEN.'
    );
  }

  validateImageFile(buffer, mimeType);

  // FormData nativo (Node 18+). Blob wrappea el Buffer para el upload multipart.
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);

  logger.info('[CloudflareImages:upload] Subiendo imagen', {
    filename,
    mimeType,
    sizeKB: Math.round(buffer.length / 1024),
  });

  const response = await fetch(`${CLOUDFLARE_API_BASE}/accounts/${accountId}/images/v1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${imagesApiToken}` },
    body: formData,
  });

  const json = await response.json();

  if (!response.ok || !json.success) {
    const errMsg = json.errors?.[0]?.message || 'Error desconocido';
    logger.error('[CloudflareImages:upload] Error de API', {
      status: response.status,
      errors: json.errors,
    });
    throw new Error(`Error de Cloudflare Images: ${errMsg}`);
  }

  const imageId = json.result.id;
  // Las variantes siguen el patrón: https://imagedelivery.net/<hash>/<imageId>/<variant>
  const url =
    json.result.variants?.find((v) => v.endsWith(`/${defaultVariant}`)) ||
    json.result.variants?.[0];

  if (!url) {
    throw new Error('Cloudflare no retornó una URL válida para la imagen subida.');
  }

  logger.info('[CloudflareImages:upload] Imagen subida exitosamente', { imageId, url });

  return { imageId, url };
};

/**
 * Elimina una imagen de Cloudflare Images por su ID.
 * @param {string} imageId
 */
const deleteImage = async (imageId) => {
  const { accountId, imagesApiToken } = config.cloudflare;

  if (!accountId || !imagesApiToken) {
    throw new Error('Cloudflare Images no está configurado.');
  }

  logger.info('[CloudflareImages:delete] Eliminando imagen', { imageId });

  const response = await fetch(
    `${CLOUDFLARE_API_BASE}/accounts/${accountId}/images/v1/${imageId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${imagesApiToken}` },
    }
  );

  const json = await response.json();

  if (!response.ok || !json.success) {
    const errMsg = json.errors?.[0]?.message || 'Error al eliminar imagen';
    logger.error('[CloudflareImages:delete] Error de API', {
      imageId,
      errors: json.errors,
    });
    throw new Error(`Error al eliminar imagen de Cloudflare: ${errMsg}`);
  }

  logger.info('[CloudflareImages:delete] Imagen eliminada', { imageId });
};

module.exports = { uploadImage, deleteImage };
