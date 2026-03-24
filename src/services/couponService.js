const prisma = require("../config/database");
const logger = require("../config/logger");
const crypto = require("crypto");

const generateCouponCode = (prefix = "COUPON") => {
  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${randomPart}`;
};

const createCoupon = async (data) => {
  const { campaignId, code, offer } = data;

  if (!campaignId || !offer) {
    throw new Error("campaignId and offer are required");
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  const couponCode = code || generateCouponCode(campaign.name.substring(0, 8).toUpperCase().replace(/\s/g, ""));

  const existingCoupon = await prisma.campaignCoupon.findUnique({
    where: { code: couponCode },
  });

  if (existingCoupon) {
    throw new Error(`Coupon with code ${couponCode} already exists`);
  }

  const coupon = await prisma.campaignCoupon.create({
    data: {
      campaignId,
      code: couponCode,
      offer,
      status: "GENERATED",
    },
  });

  logger.info(`Coupon created: ${coupon.code}`, { couponId: coupon.id, campaignId });
  return coupon;
};

const generateBulkCoupons = async (campaignId, count, offerTemplate) => {
  if (!campaignId || !count || !offerTemplate) {
    throw new Error("campaignId, count, and offerTemplate are required");
  }

  if (count < 1 || count > 1000) {
    throw new Error("count must be between 1 and 1000");
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  const coupons = [];
  const prefix = campaign.name.substring(0, 8).toUpperCase().replace(/\s/g, "");

  for (let i = 0; i < count; i++) {
    let attempts = 0;
    let couponCode;
    let isUnique = false;

    while (!isUnique && attempts < 10) {
      couponCode = generateCouponCode(prefix);
      const existing = await prisma.campaignCoupon.findUnique({
        where: { code: couponCode },
      });
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      throw new Error(`Failed to generate unique coupon code after ${attempts} attempts`);
    }

    const coupon = await prisma.campaignCoupon.create({
      data: {
        campaignId,
        code: couponCode,
        offer: offerTemplate,
        status: "GENERATED",
      },
    });

    coupons.push(coupon);
  }

  logger.info(`Generated ${coupons.length} coupons for campaign ${campaignId}`);
  return coupons;
};

const getCouponByCode = async (code) => {
  const coupon = await prisma.campaignCoupon.findUnique({
    where: { code },
    include: {
      campaign: true,
      contacts: {
        take: 5,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!coupon) {
    throw new Error("Coupon not found");
  }

  return coupon;
};

const getCouponById = async (id) => {
  const coupon = await prisma.campaignCoupon.findUnique({
    where: { id },
    include: {
      campaign: true,
      contacts: {
        take: 5,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!coupon) {
    throw new Error("Coupon not found");
  }

  return coupon;
};

const listCoupons = async (filters = {}) => {
  const { campaignId, status, page = 1, limit = 50 } = filters;

  const where = {};
  if (campaignId) where.campaignId = campaignId;
  if (status) where.status = status;

  const [coupons, total] = await Promise.all([
    prisma.campaignCoupon.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    }),
    prisma.campaignCoupon.count({ where }),
  ]);

  return {
    coupons,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const trackCouponVisit = async (code, metadata = {}) => {
  const coupon = await prisma.campaignCoupon.findUnique({
    where: { code },
  });

  if (!coupon) {
    throw new Error("Coupon not found");
  }

  const updateData = {
    visitCount: { increment: 1 },
    lastVisitedAt: new Date(),
  };

  if (coupon.status === "GENERATED" || coupon.status === "SENT") {
    updateData.status = "VISITED";
    updateData.visitedAt = new Date();
  }

  const updatedCoupon = await prisma.campaignCoupon.update({
    where: { code },
    data: updateData,
  });

  const contacts = await prisma.campaignContact.findMany({
    where: { couponId: coupon.id },
  });

  for (const contact of contacts) {
    if (contact.status !== "CONVERTED") {
      await prisma.campaignContact.update({
        where: { id: contact.id },
        data: {
          status: "VISITED",
          visitedAt: new Date(),
        },
      });
    }
  }

  logger.info(`Coupon visit tracked: ${code}`, { couponId: coupon.id });
  return updatedCoupon;
};

const markCouponAsConverted = async (code, conversionData = {}) => {
  const coupon = await prisma.campaignCoupon.findUnique({
    where: { code },
  });

  if (!coupon) {
    throw new Error("Coupon not found");
  }

  if (coupon.status === "CONVERTED") {
    logger.warn(`Coupon ${code} is already marked as converted`);
    return coupon;
  }

  const updatedCoupon = await prisma.campaignCoupon.update({
    where: { code },
    data: {
      status: "CONVERTED",
      convertedAt: new Date(),
      conversionData,
    },
  });

  const contacts = await prisma.campaignContact.findMany({
    where: { couponId: coupon.id },
  });

  for (const contact of contacts) {
    await prisma.campaignContact.update({
      where: { id: contact.id },
      data: {
        status: "CONVERTED",
        convertedAt: new Date(),
      },
    });
  }

  logger.info(`Coupon marked as converted: ${code}`, { couponId: coupon.id });
  return updatedCoupon;
};

const assignCouponToContact = async (couponId, contactId) => {
  const coupon = await prisma.campaignCoupon.findUnique({
    where: { id: couponId },
  });

  if (!coupon) {
    throw new Error("Coupon not found");
  }

  const contact = await prisma.campaignContact.findUnique({
    where: { id: contactId },
  });

  if (!contact) {
    throw new Error("Contact not found");
  }

  if (contact.campaignId !== coupon.campaignId) {
    throw new Error("Coupon and contact must belong to the same campaign");
  }

  const updatedContact = await prisma.campaignContact.update({
    where: { id: contactId },
    data: {
      couponId,
    },
  });

  logger.info(`Coupon ${coupon.code} assigned to contact ${contactId}`);
  return updatedContact;
};

const getAvailableCoupons = async (campaignId) => {
  const coupons = await prisma.campaignCoupon.findMany({
    where: {
      campaignId,
      status: "GENERATED",
      contacts: {
        none: {},
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return coupons;
};

const getCouponStats = async (couponId) => {
  const coupon = await prisma.campaignCoupon.findUnique({
    where: { id: couponId },
    include: {
      campaign: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          contacts: true,
        },
      },
    },
  });

  if (!coupon) {
    throw new Error("Coupon not found");
  }

  return {
    coupon: {
      id: coupon.id,
      code: coupon.code,
      offer: coupon.offer,
      status: coupon.status,
    },
    campaign: coupon.campaign,
    metrics: {
      totalContacts: coupon._count.contacts,
      visitCount: coupon.visitCount,
      generatedAt: coupon.generatedAt,
      sentAt: coupon.sentAt,
      visitedAt: coupon.visitedAt,
      convertedAt: coupon.convertedAt,
      lastVisitedAt: coupon.lastVisitedAt,
    },
  };
};

module.exports = {
  createCoupon,
  generateBulkCoupons,
  getCouponByCode,
  getCouponById,
  listCoupons,
  trackCouponVisit,
  markCouponAsConverted,
  assignCouponToContact,
  getAvailableCoupons,
  getCouponStats,
  generateCouponCode,
};
