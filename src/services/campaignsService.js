const prisma = require("../config/database");
const prismaGeo = require("../config/database-geo");
const logger = require("../config/logger");
const geoService = require("./geoService");
const campaignBatchDispatcherService = require("./campaignBatchDispatcherService");

const createCampaign = async (data) => {
  const {
    name,
    description,
    centerLat,
    centerLng,
    radiusMeters,
    filters,
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
      status: "DRAFT",
      centerLat,
      centerLng,
      radiusMeters,
      filters,
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

const startCampaign = async (campaignId, options = {}) => {
  const {
    agentId,
    targetConcurrencyLimit,
    maxRecipientsPerRequest,
    scheduledTimeUnix,
    agentPhoneNumberId,
  } = options;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      status: true,
      agentConfigId: true,
      couponPrefix: true,
      offer: true,
    },
  });

  if (!campaign) {
    const error = new Error("Campaign not found");
    error.statusCode = 404;
    throw error;
  }

  if (campaign.status === "ACTIVE") {
    const error = new Error("Campaign is already active");
    error.statusCode = 409;
    throw error;
  }

  if (campaign.status === "COMPLETED" || campaign.status === "CANCELLED") {
    const error = new Error(`Cannot start campaign with status ${campaign.status}`);
    error.statusCode = 409;
    throw error;
  }

  const resolvedAgentId = agentId || campaign.agentConfigId;
  if (!resolvedAgentId) {
    const error = new Error("agentId is required to start campaign");
    error.statusCode = 400;
    throw error;
  }

  const contacts = await prisma.campaignContact.findMany({
    where: {
      campaignId,
      status: "PENDING",
    },
    select: {
      id: true,
      campaignId: true,
      establishmentId: true,
      establishmentName: true,
      establishmentPhone: true,
      establishmentData: true,
    },
  });

  if (contacts.length === 0) {
    const error = new Error("Campaign has no pending contacts to dispatch");
    error.statusCode = 400;
    throw error;
  }

  const establishmentIds = [...new Set(contacts.map((contact) => contact.establishmentId).filter(Boolean))];
  let establishments = [];

  if (establishmentIds.length > 0) {
    try {
      establishments = await prismaGeo.establishment.findMany({
        where: {
          id: { in: establishmentIds },
        },
        select: {
          id: true,
          name: true,
          businessName: true,
          phone: true,
        },
      });
    } catch (geoError) {
      logger.warn("Geo DB lookup failed while starting campaign, using campaign contact snapshot only", {
        campaignId,
        error: geoError.message,
      });
    }
  }

  const establishmentById = new Map(establishments.map((establishment) => [establishment.id, establishment]));

  const recipients = contacts.map((contact) => {
    const establishment = establishmentById.get(contact.establishmentId);
    const contactData =
      contact.establishmentData && typeof contact.establishmentData === "object"
        ? contact.establishmentData
        : {};

    const businessName =
      contact.establishmentName ||
      establishment?.businessName ||
      establishment?.name ||
      contactData.businessName ||
      null;

    const prospectName =
      contactData.prospectName ||
      contactData.decisionMakerName ||
      contactData.contactName ||
      businessName ||
      "Prospecto";

    const phoneNumber =
      contact.establishmentPhone ||
      establishment?.phone ||
      contactData.phone ||
      contactData.whatsapp ||
      null;

    return {
      campaignContactId: contact.id,
      phone_number: phoneNumber,
      dynamic_variables: {
        campaignId,
        campaignContactId: contact.id,
        prospectName,
        businessName,
        couponType: campaign.couponPrefix || contactData.couponType || null,
        agentConfigId: resolvedAgentId,
        campaignContext: {
          campaignName: campaign.name,
          offer: campaign.offer || null,
        },
      },
    };
  });

  const dispatchResult = await campaignBatchDispatcherService.submitCampaignBatch({
    campaignId,
    recipients,
    agentId: resolvedAgentId,
    targetConcurrencyLimit,
    maxRecipientsPerRequest,
    scheduledTimeUnix,
    callName: `campaign-${campaign.name}`,
    agentPhoneNumberId,
  });

  const invalidContactReasons = new Map();
  for (const invalidEntry of dispatchResult.invalidRecipients || []) {
    const campaignContactId = invalidEntry?.recipient?.dynamic_variables?.campaignContactId;
    if (!campaignContactId) {
      continue;
    }
    invalidContactReasons.set(campaignContactId, invalidEntry.reason || "Invalid recipient");
  }

  const dispatchedContactIds = recipients
    .map((recipient) => recipient.campaignContactId)
    .filter(Boolean);

  await prisma.$transaction([
    prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: "ACTIVE",
        startedAt: new Date(),
      },
    }),
    prisma.campaignContact.updateMany({
      where: {
        id: { in: dispatchedContactIds },
        campaignId,
        providerBatchId: { not: null },
      },
      data: {
        status: "CALLING",
      },
    }),
    ...Array.from(invalidContactReasons.entries()).map(([contactId, reason]) =>
      prisma.campaignContact.update({
        where: { id: contactId },
        data: {
          status: "FAILED",
          errorReason: reason,
        },
      })
    ),
  ]);

  logger.info("Campaign started with batch dispatch", {
    campaignId,
    agentId: resolvedAgentId,
    totalRecipients: recipients.length,
    dispatchedRecipients: dispatchResult.dispatchedRecipients,
    skippedRecipients: dispatchResult.skippedRecipients,
    providerBatchIds: dispatchResult.providerBatchIds,
  });

  return {
    campaignId,
    status: "ACTIVE",
    startedAt: new Date().toISOString(),
    dispatch: dispatchResult,
  };
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
  const validStatuses = [
    "PENDING",
    "CALLING",
    "CALLED",
    "RESPONDED",
    "SENT",
    "DELIVERED",
    "VISITED",
    "CONVERTED",
    "FAILED",
  ];
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
  startCampaign,
  getCampaignContacts,
  updateContactStatus,
  getCampaignStats,
};
