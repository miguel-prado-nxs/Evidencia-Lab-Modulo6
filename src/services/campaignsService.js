const prisma = require("../config/database");
const logger = require("../config/logger");
const geoService = require("./geoService");

const createCampaign = async (data) => {
  const {
    name,
    description,
    type,
    centerLat,
    centerLng,
    radiusMeters,
    activityCodes,
    employeeRanges,
    filters,
    agentConfigId,
    agentConfigName,
    offer,
    couponPrefix,
    createdBy,
  } = data;

  if (!name) {
    throw new Error("Campaign name is required");
  }

  if (centerLat && centerLng && !radiusMeters) {
    throw new Error("radiusMeters is required when centerLat and centerLng are provided");
  }

  if (radiusMeters && radiusMeters < 0) {
    throw new Error("radiusMeters must be a positive number");
  }

  const campaign = await prisma.campaign.create({
    data: {
      name,
      description,
      type,
      status: "DRAFT",
      centerLat,
      centerLng,
      radiusMeters,
      activityCodes: activityCodes || [],
      employeeRanges: employeeRanges || [],
      filters,
      agentConfigId,
      agentConfigName,
      offer,
      couponPrefix,
      createdBy,
    },
  });

  logger.info(`Campaign created: ${campaign.id}`, { campaignId: campaign.id });
  return campaign;
};

const getCampaignById = async (id) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      contacts: {
        take: 10,
        orderBy: { createdAt: "desc" },
      },
      coupons: {
        take: 10,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  return campaign;
};

const listCampaigns = async (filters = {}) => {
  const { status, createdBy, page = 1, limit = 20 } = filters;

  const where = {};
  if (status) where.status = status;
  if (createdBy) where.createdBy = createdBy;

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: {
          select: {
            contacts: true,
            coupons: true,
          },
        },
      },
    }),
    prisma.campaign.count({ where }),
  ]);

  return {
    campaigns,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const updateCampaign = async (id, data) => {
  const { name, description, status, centerLat, centerLng, radiusMeters, filters } = data;

  const existingCampaign = await prisma.campaign.findUnique({
    where: { id },
  });

  if (!existingCampaign) {
    throw new Error("Campaign not found");
  }

  if (existingCampaign.status === "COMPLETED" || existingCampaign.status === "CANCELLED") {
    throw new Error(`Cannot update campaign with status ${existingCampaign.status}`);
  }

  if (radiusMeters && radiusMeters < 0) {
    throw new Error("radiusMeters must be a positive number");
  }

  const campaign = await prisma.campaign.update({
    where: { id },
    data: {
      name,
      description,
      status,
      centerLat,
      centerLng,
      radiusMeters,
      filters,
    },
  });

  logger.info(`Campaign updated: ${campaign.id}`, { campaignId: campaign.id });
  return campaign;
};

const deleteCampaign = async (id) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (campaign.status === "ACTIVE") {
    throw new Error("Cannot delete an active campaign. Pause or cancel it first.");
  }

  await prisma.campaign.delete({
    where: { id },
  });

  logger.info(`Campaign deleted: ${id}`, { campaignId: id });
  return { success: true };
};

const assignContactsToCampaign = async (campaignId, establishmentIds) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (!Array.isArray(establishmentIds) || establishmentIds.length === 0) {
    throw new Error("establishmentIds must be a non-empty array");
  }

  const contacts = await prisma.$transaction(
    establishmentIds.map((establishmentId) =>
      prisma.campaignContact.upsert({
        where: {
          campaignId_establishmentId: {
            campaignId,
            establishmentId,
          },
        },
        update: {},
        create: {
          campaignId,
          establishmentId,
          status: "PENDING",
        },
      })
    )
  );

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      totalContacts: {
        increment: contacts.length,
      },
    },
  });

  logger.info(`Assigned ${contacts.length} contacts to campaign ${campaignId}`);
  return contacts;
};

const assignContactsWithGeoFilter = async (campaignId, options = {}) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (!campaign.centerLat || !campaign.centerLng || !campaign.radiusMeters) {
    throw new Error("Campaign must have geographic coordinates and radius defined");
  }

  const establishments = await geoService.findEstablishmentsInRadius(
    campaign.centerLat,
    campaign.centerLng,
    campaign.radiusMeters,
    options
  );

  if (establishments.length === 0) {
    logger.info(`No establishments found in radius for campaign ${campaignId}`);
    return [];
  }

  const establishmentIds = establishments.map((e) => e.id);
  return assignContactsToCampaign(campaignId, establishmentIds);
};

const getCampaignContacts = async (campaignId, filters = {}) => {
  const { status, page = 1, limit = 50 } = filters;

  const where = { campaignId };
  if (status) where.status = status;

  const [contacts, total] = await Promise.all([
    prisma.campaignContact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        coupon: true,
      },
    }),
    prisma.campaignContact.count({ where }),
  ]);

  return {
    contacts,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const updateContactStatus = async (contactId, status, metadata = {}) => {
  const validStatuses = ["PENDING", "SENT", "DELIVERED", "VISITED", "CONVERTED", "FAILED"];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }

  const updateData = { status };

  if (status === "SENT" && !metadata.sentAt) {
    updateData.sentAt = new Date();
  }
  if (status === "VISITED" && !metadata.visitedAt) {
    updateData.visitedAt = new Date();
  }
  if (status === "CONVERTED" && !metadata.convertedAt) {
    updateData.convertedAt = new Date();
  }
  if (metadata.messageId) {
    updateData.messageId = metadata.messageId;
  }
  if (metadata.errorReason) {
    updateData.errorReason = metadata.errorReason;
  }

  const contact = await prisma.campaignContact.update({
    where: { id: contactId },
    data: updateData,
  });

  const campaign = await prisma.campaign.findUnique({
    where: { id: contact.campaignId },
  });

  if (status === "SENT" || status === "DELIVERED" || status === "CALLED") {
    await prisma.campaign.update({
      where: { id: contact.campaignId },
      data: { totalCalled: { increment: 1 } },
    });
  } else if (status === "RESPONDED" || status === "VISITED") {
    await prisma.campaign.update({
      where: { id: contact.campaignId },
      data: { totalResponded: { increment: 1 } },
    });
  } else if (status === "CONVERTED") {
    await prisma.campaign.update({
      where: { id: contact.campaignId },
      data: { totalConverted: { increment: 1 } },
    });
  } else if (status === "FAILED") {
    await prisma.campaign.update({
      where: { id: contact.campaignId },
      data: { totalFailed: { increment: 1 } },
    });
  }

  logger.info(`Contact ${contactId} status updated to ${status}`);
  return contact;
};

const getCampaignStats = async (campaignId) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      _count: {
        select: {
          contacts: true,
          coupons: true,
        },
      },
    },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  const statusBreakdown = await prisma.campaignContact.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: true,
  });

  // Get conversions by day for the last 7 days
  const convertedContacts = await prisma.campaignContact.findMany({
    where: {
      campaignId,
      status: "CONVERTED",
      convertedAt: {
        not: null,
      },
    },
    select: {
      convertedAt: true,
    },
  });

  // Group conversions by day
  const conversionsByDay = {};
  convertedContacts.forEach((contact) => {
    if (contact.convertedAt) {
      const date = new Date(contact.convertedAt);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
      conversionsByDay[dateKey] = (conversionsByDay[dateKey] || 0) + 1;
    }
  });

  // Create array for last 7 days
  const conversionTimeline = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    conversionTimeline.push({
      date: dateKey,
      conversions: conversionsByDay[dateKey] || 0,
    });
  }

  const conversionRate = campaign.totalCalled > 0
    ? (campaign.totalConverted / campaign.totalCalled) * 100
    : 0;

  const responseRate = campaign.totalCalled > 0
    ? (campaign.totalResponded / campaign.totalCalled) * 100
    : 0;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
    },
    metrics: {
      totalContacts: campaign.totalContacts,
      totalCalled: campaign.totalCalled,
      totalResponded: campaign.totalResponded,
      totalConverted: campaign.totalConverted,
      totalFailed: campaign.totalFailed,
      totalCoupons: campaign._count.coupons,
      conversionRate: conversionRate.toFixed(2),
      responseRate: responseRate.toFixed(2),
    },
    statusBreakdown: statusBreakdown.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {}),
    conversionTimeline,
  };
};

module.exports = {
  createCampaign,
  getCampaignById,
  listCampaigns,
  updateCampaign,
  deleteCampaign,
  assignContactsToCampaign,
  assignContactsWithGeoFilter,
  getCampaignContacts,
  updateContactStatus,
  getCampaignStats,
};
