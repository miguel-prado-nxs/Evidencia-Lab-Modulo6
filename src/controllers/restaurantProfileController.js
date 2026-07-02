const restaurantProfileService = require('../services/restaurantProfileService');
const logger = require('../config/logger');

async function upsertProfile(req, res) {
  try {
    const {
      establishmentId,
      leadId,
      businessName,
      cuisineType,
      contactPhone,
      contactEmail,
      contactWhatsapp,
      timezone,
      restaurantId,
      direccionId,
      calle,
      numero_exterior,
      numero_interior,
      colonia,
      municipio,
      estado,
      pais,
      codigo_postal,
      referencias,
      logoUrl,
      step1Completed,
      step2Completed,
      step3Completed,
    } = req.body;

    if (!establishmentId) {
      return res.status(400).json({ success: false, error: 'establishmentId es requerido' });
    }
    if (!businessName) {
      return res.status(400).json({ success: false, error: 'El nombre comercial es requerido' });
    }

    const address = {
      calle,
      numero_exterior,
      numero_interior,
      colonia,
      municipio,
      estado,
      pais,
      codigo_postal,
      referencias,
    };

    const result = await restaurantProfileService.upsertProfile({
      establishmentId,
      leadId,
      businessName,
      cuisineType,
      contactPhone,
      contactEmail,
      contactWhatsapp,
      timezone,
      restaurantId,
      direccionId,
      address,
      logoUrl,
      step1Completed,
      step2Completed,
      step3Completed,
    });

    res.status(result.created ? 201 : 200).json({
      success: true,
      data: result.profile,
      posSyncEnabled: result.posSyncEnabled,
      posSyncError: result.posSyncError || null,
      message: result.created
        ? 'Perfil de restaurante creado'
        : 'Perfil de restaurante actualizado',
    });
  } catch (error) {
    logger.error('[RestaurantProfile] Error upsert:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error guardando perfil de restaurante',
    });
  }
}

async function getProfile(req, res) {
  try {
    const { establishmentId } = req.params;
    if (!establishmentId) {
      return res.status(400).json({ success: false, error: 'establishmentId es requerido' });
    }

    const profile = await restaurantProfileService.getByEstablishmentId(establishmentId);
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Perfil no encontrado' });
    }

    res.json({ success: true, data: profile });
  } catch (error) {
    logger.error('[RestaurantProfile] Error getProfile:', error);
    res.status(500).json({ success: false, error: error.message || 'Error obteniendo perfil' });
  }
}

module.exports = {
  upsertProfile,
  getProfile,
};
