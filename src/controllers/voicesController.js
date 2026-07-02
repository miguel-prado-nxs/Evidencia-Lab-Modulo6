const { PrismaClient } = require('@prisma/client');
const logger = require('../config/logger');

const prisma = new PrismaClient();

/**
 * Listar voces activas desde elevenlabs_personalities
 * GET /api/voices
 */
const listVoices = async (req, res) => {
  try {
    const voices = await prisma.elevenLabsPersonality.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        voiceId: true,
        agentId: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json({
      success: true,
      data: voices,
    });
  } catch (error) {
    logger.error('Error listing voices:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener las voces',
    });
  }
};

/**
 * Obtener una voz por ID
 * GET /api/voices/:id
 */
const getVoiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const voice = await prisma.elevenLabsPersonality.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        voiceId: true,
        agentId: true,
        isActive: true,
      },
    });

    if (!voice) {
      return res.status(404).json({
        success: false,
        error: 'Voz no encontrada',
      });
    }

    res.json({
      success: true,
      data: voice,
    });
  } catch (error) {
    logger.error('Error getting voice:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener la voz',
    });
  }
};

module.exports = {
  listVoices,
  getVoiceById,
};
