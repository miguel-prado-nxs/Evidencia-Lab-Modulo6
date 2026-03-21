const prisma = require("../config/database");
const logger = require("../config/logger");

const list = async (req, res, next) => {
  try {
    const { active, scenario } = req.query;

    const where = {};
    if (active !== undefined) {
      where.active = active === 'true';
    }
    if (scenario) {
      where.scenarios = {
        has: scenario
      };
    }

    const templates = await prisma.couponTemplate.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    next(error);
  }
};

const getByType = async (req, res, next) => {
  try {
    const { type } = req.params;

    const template = await prisma.couponTemplate.findUnique({
      where: { couponType: type }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: "Template not found"
      });
    }

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {
  try {
    const {
      couponType,
      name,
      description,
      scenarios,
      percentOff,
      durationMonths,
      trialDays,
      messageTemplate,
      mediaUrl,
      maxPerUser,
      expiresHours,
      validFor,
      priority
    } = req.body;

    const template = await prisma.couponTemplate.create({
      data: {
        couponType,
        name,
        description,
        scenarios: scenarios || [],
        percentOff,
        durationMonths,
        trialDays,
        messageTemplate,
        mediaUrl,
        maxPerUser: maxPerUser || 1,
        expiresHours: expiresHours || 48,
        validFor: validFor || [],
        priority: priority || 0
      }
    });

    logger.info(`Coupon template created: ${template.couponType}`, {
      templateId: template.id
    });

    res.status(201).json({
      success: true,
      data: template
    });
  } catch (error) {
    next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const { type } = req.params;
    const {
      name,
      description,
      scenarios,
      percentOff,
      durationMonths,
      trialDays,
      messageTemplate,
      mediaUrl,
      maxPerUser,
      expiresHours,
      validFor,
      active,
      priority
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (scenarios !== undefined) updateData.scenarios = scenarios;
    if (percentOff !== undefined) updateData.percentOff = percentOff;
    if (durationMonths !== undefined) updateData.durationMonths = durationMonths;
    if (trialDays !== undefined) updateData.trialDays = trialDays;
    if (messageTemplate !== undefined) updateData.messageTemplate = messageTemplate;
    if (mediaUrl !== undefined) updateData.mediaUrl = mediaUrl;
    if (maxPerUser !== undefined) updateData.maxPerUser = maxPerUser;
    if (expiresHours !== undefined) updateData.expiresHours = expiresHours;
    if (validFor !== undefined) updateData.validFor = validFor;
    if (active !== undefined) updateData.active = active;
    if (priority !== undefined) updateData.priority = priority;

    const template = await prisma.couponTemplate.update({
      where: { couponType: type },
      data: updateData
    });

    logger.info(`Coupon template updated: ${template.couponType}`, {
      templateId: template.id
    });

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    const { type } = req.params;

    await prisma.couponTemplate.delete({
      where: { couponType: type }
    });

    logger.info(`Coupon template deleted: ${type}`);

    res.json({
      success: true,
      message: "Template deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  list,
  getByType,
  create,
  update,
  remove
};
