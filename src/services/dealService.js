const prisma = require("../config/database");

// Crear deal desde un lead ganado
const createDeal = async (data) => {
  const {
    leadId,
    customerId,
    planType,
    planPrice,
    setupFee,
  } = data;

  // Obtener lead y partner
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { partner: true },
  });

  if (!lead) throw new Error("Lead no encontrado");
  if (lead.deal) throw new Error("Este lead ya tiene un deal asociado");

  // Calcular valores
  const totalValue = (parseFloat(planPrice) * 12) + parseFloat(setupFee || 0);
  const commissionRate = parseFloat(lead.partner.commissionRate);
  const commissionAmount = totalValue * commissionRate;

  // Crear deal y actualizar lead en transacción
  const deal = await prisma.$transaction(async (tx) => {
    // Crear deal
    const newDeal = await tx.deal.create({
      data: {
        partnerId: lead.partnerId,
        leadId,
        customerId,
        businessName: lead.businessName,
        planType,
        planPrice,
        setupFee: setupFee || 0,
        totalValue,
        commissionRate,
        commissionAmount,
        status: "PENDING",
        closedAt: new Date(),
      },
    });

    // Actualizar lead a WON
    await tx.lead.update({
      where: { id: leadId },
      data: { status: "WON" },
    });

    // Crear comisión inicial (signup bonus)
    const signupBonus = commissionAmount * 0.3; // 30% como bonus inicial
    await tx.commission.create({
      data: {
        partnerId: lead.partnerId,
        dealId: newDeal.id,
        type: "SIGNUP_BONUS",
        amount: signupBonus,
        status: "PENDING",
      },
    });

    // Actualizar stats del partner
    await tx.partner.update({
      where: { id: lead.partnerId },
      data: {
        totalDeals: { increment: 1 },
        totalRevenue: { increment: totalValue },
        totalCommission: { increment: commissionAmount },
        firstSaleAt: lead.partner.firstSaleAt || new Date(),
        lastActivityAt: new Date(),
      },
    });

    // Registrar actividad
    await tx.activity.create({
      data: {
        partnerId: lead.partnerId,
        leadId,
        type: "DEAL_CLOSED",
        description: `Deal cerrado: ${lead.businessName} - ${planType}`,
        metadata: {
          totalValue,
          commissionAmount,
          planType,
        },
      },
    });

    return newDeal;
  });

  return deal;
};

// Obtener deal por ID
const getDealById = async (id) => {
  return prisma.deal.findUnique({
    where: { id },
    include: {
      partner: {
        select: {
          id: true,
          code: true,
          companyName: true,
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      lead: true,
      commissions: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
};

// Listar deals con filtros
const listDeals = async (filters = {}) => {
  const {
    partnerId,
    status,
    dateFrom,
    dateTo,
    page = 1,
    limit = 20,
    sortBy = "closedAt",
    sortOrder = "desc",
  } = filters;

  const where = {};

  if (partnerId) where.partnerId = partnerId;
  if (status) where.status = status;
  if (dateFrom || dateTo) {
    where.closedAt = {};
    if (dateFrom) where.closedAt.gte = new Date(dateFrom);
    if (dateTo) where.closedAt.lte = new Date(dateTo);
  }

  const [deals, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      include: {
        partner: {
          select: {
            id: true,
            code: true,
            companyName: true,
            user: {
              select: {
                name: true,
              },
            },
          },
        },
        lead: {
          select: {
            id: true,
            contactName: true,
            email: true,
          },
        },
        _count: {
          select: {
            commissions: true,
          },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.deal.count({ where }),
  ]);

  return {
    data: deals,
    total,
    page,
    pageSize: limit,
    totalPages: Math.ceil(total / limit),
  };
};

// Actualizar status del deal
const updateDealStatus = async (id, status) => {
  const deal = await prisma.deal.findUnique({ where: { id } });
  if (!deal) throw new Error("Deal no encontrado");

  const updateData = { status };

  if (status === "ACTIVE" && !deal.activatedAt) {
    updateData.activatedAt = new Date();
  }
  if (status === "CHURNED") {
    updateData.cancelledAt = new Date();
    
    // Cancelar comisiones pendientes
    await prisma.commission.updateMany({
      where: {
        dealId: id,
        status: "PENDING",
      },
      data: { status: "CANCELLED" },
    });
  }

  return prisma.deal.update({
    where: { id },
    data: updateData,
  });
};

module.exports = {
  createDeal,
  getDealById,
  listDeals,
  updateDealStatus,
};

