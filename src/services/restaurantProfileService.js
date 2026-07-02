const axios = require('axios');
const FormData = require('form-data');
const prisma = require('../config/database');
const logger = require('../config/logger');

const POS_API_BASE_URL = process.env.POS_API_BASE_URL || '';
const POS_API_TOKEN = process.env.POS_API_TOKEN || '';

const hasPosIntegration = Boolean(POS_API_BASE_URL && POS_API_TOKEN);

const normalizeInt = (value) => {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const pickAddress = (address = {}) => ({
  calle: address.calle || null,
  numero_exterior: address.numero_exterior || null,
  numero_interior: address.numero_interior || null,
  colonia: address.colonia || null,
  municipio: address.municipio || null,
  estado: address.estado || null,
  pais: address.pais || null,
  codigo_postal: address.codigo_postal || null,
  referencias: address.referencias || null,
});

async function upsertDireccion(addressPayload, existingDireccionId) {
  if (!hasPosIntegration) return { direccionId: existingDireccionId || null, skipped: true };

  const url = existingDireccionId
    ? `${POS_API_BASE_URL}/api/direccion/v1/${existingDireccionId}`
    : `${POS_API_BASE_URL}/api/direccion/v1`;

  const method = existingDireccionId ? 'put' : 'post';

  try {
    const { data } = await axios({
      method,
      url,
      data: addressPayload,
      headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' },
    });

    const direccion = data?.direccion || data;
    return { direccionId: direccion?.id ?? existingDireccionId ?? null };
  } catch (error) {
    logger.error(
      `[upsertDireccion] Error ${method.toUpperCase()} ${url}:`,
      error.response?.data || error.message
    );
    throw error;
  }
}

async function upsertRestaurante(payload, existingRestaurantId) {
  if (!hasPosIntegration)
    return { restauranteId: existingRestaurantId || null, logoUrl: null, skipped: true };

  const url = existingRestaurantId
    ? `${POS_API_BASE_URL}/api/restaurantes/v1/${existingRestaurantId}`
    : `${POS_API_BASE_URL}/api/restaurantes/v1`;
  const method = existingRestaurantId ? 'put' : 'post';

  try {
    const { data } = await axios({
      method,
      url,
      data: payload,
      headers: { Authorization: `Bearer ${POS_API_TOKEN}`, 'Content-Type': 'application/json' },
    });

    const restaurante = data?.restaurante || data;
    return {
      restauranteId: restaurante?.id ?? existingRestaurantId ?? null,
      logoUrl: restaurante?.logo_url ?? null,
    };
  } catch (error) {
    logger.error(
      `[upsertRestaurante] Error ${method.toUpperCase()} ${url}:`,
      error.response?.data || error.message
    );
    throw error;
  }
}

async function uploadLogo(restauranteId, file) {
  if (!hasPosIntegration || !file) return null;
  const form = new FormData();
  form.append('file', file.buffer, {
    filename: file.originalname || 'logo.jpg',
    contentType: file.mimetype || 'image/jpeg',
  });

  const { data } = await axios.post(
    `${POS_API_BASE_URL}/api/restaurantes/v1/${restauranteId}/logo`,
    form,
    {
      headers: {
        Authorization: `Bearer ${POS_API_TOKEN}`,
        ...form.getHeaders(),
      },
    }
  );
  const restaurante = data?.restaurante || data;
  return restaurante?.logo_url || null;
}

function computeStep1Completed(input, logoUrlFromPos, existingProfile) {
  // Paso 1 se considera completo con: nombre, algún contacto y logo
  const hasName = Boolean(input.businessName);
  const hasContact = Boolean(input.contactPhone || input.contactEmail || input.contactWhatsapp);
  const hasLogo = Boolean(logoUrlFromPos || existingProfile?.logoUrl);
  return hasName && hasContact && hasLogo;
}

async function upsertProfile(input) {
  const addressSnapshot = pickAddress(input.address);

  const existing = await prisma.restaurantProfile.findUnique({
    where: { establishmentId: input.establishmentId },
  });

  const incomingDireccionId = normalizeInt(input.direccionId);
  const incomingRestaurantId = normalizeInt(input.restaurantId);

  let direccionId = incomingDireccionId || existing?.direccionId || null;
  let restaurantId = incomingRestaurantId || existing?.restaurantId || null;
  let logoUrlFromPos = input.logoUrl || existing?.logoUrl || null;

  let posSyncError = null;
  try {
    if (hasPosIntegration) {
      const direccionResult = await upsertDireccion(addressSnapshot, direccionId);
      direccionId = direccionResult.direccionId;

      const restaurantePayload = {
        nombre: input.businessName,
        descripcion: input.cuisineType || null,
        direccion_id: direccionId,
        activo: true,
        logo_url: existing?.logoUrl || undefined,
      };

      const restauranteResult = await upsertRestaurante(restaurantePayload, restaurantId);
      restaurantId = restauranteResult.restauranteId;
      logoUrlFromPos = restauranteResult.logoUrl || logoUrlFromPos;

      if (restaurantId && input.logoFile) {
        logoUrlFromPos = await uploadLogo(restaurantId, input.logoFile);
      }
    }
  } catch (error) {
    logger.error(
      '[RestaurantProfile] Error sync POS:',
      error?.response?.data || error?.message || error
    );
    posSyncError = error?.response?.data || { message: error?.message || String(error) };
  }

  const step1Completed = computeStep1Completed(input, logoUrlFromPos, existing);
  const step2Completed =
    input?.step2Completed === true || input?.step2Completed === 'true'
      ? true
      : existing?.step2Completed || false;
  const step3Completed =
    input?.step3Completed === true || input?.step3Completed === 'true'
      ? true
      : existing?.step3Completed || false;

  const provisionStatus = restaurantId ? 'provisioned' : 'pending';
  const provisionedAt =
    restaurantId && !existing?.restaurantId ? new Date() : existing?.provisionedAt || null;

  const dataToSave = {
    establishmentId: input.establishmentId,
    leadId: input.leadId || existing?.leadId || null,
    restaurantId: normalizeInt(restaurantId),
    direccionId: normalizeInt(direccionId),
    businessName: input.businessName,
    cuisineType: input.cuisineType || null,
    contactPhone: input.contactPhone || null,
    contactEmail: input.contactEmail || null,
    contactWhatsapp: input.contactWhatsapp || null,
    timezone: input.timezone || null,
    address: addressSnapshot,
    logoUrl: logoUrlFromPos || existing?.logoUrl || null,
    step1Completed,
    step2Completed,
    step3Completed,
    provisionStatus,
    provisionedAt,
  };

  const saved = await prisma.restaurantProfile.upsert({
    where: { establishmentId: input.establishmentId },
    update: dataToSave,
    create: dataToSave,
  });

  return {
    profile: saved,
    created: !existing,
    posSyncEnabled: hasPosIntegration,
    posSyncError,
  };
}

async function getByEstablishmentId(establishmentId) {
  return prisma.restaurantProfile.findUnique({ where: { establishmentId } });
}

module.exports = {
  upsertProfile,
  getByEstablishmentId,
};
