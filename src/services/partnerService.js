const prisma = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// Generar código único de partner
const generatePartnerCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'EO-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Crear nuevo partner
// autoApprove: si true, crea el partner ya activo (para creación desde admin)
const createPartner = async (data, autoApprove = false) => {
  const { email, password, name, type, companyName, phone, website, country, state, city } = data;

  // Hash de la contraseña
  const passwordHash = await bcrypt.hash(password, 10);

  // Generar código único
  let code;
  let isUnique = false;
  while (!isUnique) {
    code = generatePartnerCode();
    const existing = await prisma.partner.findUnique({ where: { code } });
    if (!existing) isUnique = true;
  }

  // Generar link de referido
  const referralLink = `https://easyorder.mx/?ref=${code}`;

  // Determinar comisión según tipo (máximo 15%)
  const commissionRates = {
    AFFILIATE: 0.1,
    REFERRAL: 0.08,
    RESELLER: 0.15,
    SOLUTIONS: 0.12,
    TECHNOLOGY: 0.08,
  };

  // Determinar status y role según autoApprove
  const initialStatus = autoApprove ? 'ACTIVE' : 'PENDING';
  const initialRole = autoApprove ? 'PARTNER' : 'PENDING';

  // Crear usuario y partner en una transacción
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: initialRole,
      },
    });

    const partner = await tx.partner.create({
      data: {
        userId: user.id,
        code,
        type,
        tier: 'REGISTERED',
        status: initialStatus,
        companyName,
        phone,
        website,
        country: country || 'MX',
        state,
        city,
        commissionRate: commissionRates[type] || 0.15,
        referralLink,
        ...(autoApprove && { approvedAt: new Date() }),
      },
    });

    // Registrar actividad
    await tx.activity.create({
      data: {
        partnerId: partner.id,
        type: autoApprove ? 'PARTNER_CREATED_BY_ADMIN' : 'PARTNER_REGISTERED',
        description: autoApprove
          ? `Partner ${name} creado y activado por admin como ${type}`
          : `Partner ${name} registrado como ${type}`,
      },
    });

    return { user, partner };
  });

  return result;
};

// Obtener partner por ID
const getPartnerById = async (id) => {
  return prisma.partner.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          leads: true,
          deals: true,
          commissions: true,
        },
      },
    },
  });
};

// Obtener partner por código
const getPartnerByCode = async (code) => {
  return prisma.partner.findUnique({
    where: { code },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });
};

// Listar partners con filtros
const listPartners = async (filters = {}) => {
  const {
    type,
    tier,
    status,
    search,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = filters;

  const where = {};

  if (type) where.type = type;
  if (tier) where.tier = tier;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { companyName: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [partners, total] = await Promise.all([
    prisma.partner.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        _count: {
          select: {
            leads: true,
            deals: true,
          },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.partner.count({ where }),
  ]);

  return {
    data: partners,
    total,
    page,
    pageSize: limit,
    totalPages: Math.ceil(total / limit),
  };
};

// Actualizar partner
const updatePartner = async (id, data) => {
  return prisma.partner.update({
    where: { id },
    data: {
      ...data,
      updatedAt: new Date(),
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });
};

// Cambiar status del partner
const updatePartnerStatus = async (id, status) => {
  const partner = await prisma.partner.findUnique({ where: { id } });
  if (!partner) throw new Error('Partner no encontrado');

  const updateData = { status };

  // Si se está aprobando, actualizar rol del usuario
  if (status === 'ACTIVE' && partner.status === 'PENDING') {
    updateData.approvedAt = new Date();

    await prisma.user.update({
      where: { id: partner.userId },
      data: { role: 'PARTNER' },
    });

    await prisma.activity.create({
      data: {
        partnerId: id,
        type: 'PARTNER_APPROVED',
        description: 'Partner aprobado y activado',
      },
    });
  }

  return prisma.partner.update({
    where: { id },
    data: updateData,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
    },
  });
};

// Cambiar tier del partner
const updatePartnerTier = async (id, tier) => {
  const partner = await prisma.partner.findUnique({ where: { id } });
  if (!partner) throw new Error('Partner no encontrado');

  // Actualizar comisión según tier (bonos +5/10/15%)
  const commissionRates = {
    REGISTERED: partner.commissionRate,
    SILVER: partner.commissionRate + 0.05,
    GOLD: partner.commissionRate + 0.1,
    ELITE: partner.commissionRate + 0.15,
  };

  await prisma.activity.create({
    data: {
      partnerId: id,
      type: 'PARTNER_TIER_UPGRADE',
      description: `Partner ascendido de ${partner.tier} a ${tier}`,
    },
  });

  return prisma.partner.update({
    where: { id },
    data: {
      tier,
      commissionRate: commissionRates[tier],
    },
  });
};

// Obtener estadísticas del partner
const getPartnerStats = async (partnerId) => {
  const [
    partner,
    leadsCount,
    leadsByStatus,
    dealsCount,
    dealsThisMonth,
    commissionsTotal,
    commissionsPending,
  ] = await Promise.all([
    prisma.partner.findUnique({ where: { id: partnerId } }),
    prisma.lead.count({ where: { partnerId } }),
    prisma.lead.groupBy({
      by: ['status'],
      where: { partnerId },
      _count: { status: true },
    }),
    prisma.deal.count({ where: { partnerId } }),
    prisma.deal.count({
      where: {
        partnerId,
        closedAt: {
          gte: new Date(new Date().setDate(1)), // Primer día del mes
        },
      },
    }),
    prisma.commission.aggregate({
      where: { partnerId },
      _sum: { amount: true },
    }),
    prisma.commission.aggregate({
      where: { partnerId, status: 'PENDING' },
      _sum: { amount: true },
    }),
  ]);

  const leadStatusMap = {};
  leadsByStatus.forEach((item) => {
    leadStatusMap[item.status] = item._count.status;
  });

  // Calcular progreso al siguiente tier
  const tierRequirements = {
    REGISTERED: 0,
    SILVER: 5,
    GOLD: 20,
    ELITE: 50,
  };

  const currentTierReq = tierRequirements[partner.tier];
  const nextTier =
    partner.tier === 'REGISTERED'
      ? 'SILVER'
      : partner.tier === 'SILVER'
        ? 'GOLD'
        : partner.tier === 'GOLD'
          ? 'ELITE'
          : null;

  const nextTierReq = nextTier ? tierRequirements[nextTier] : null;
  const progressToNextTier = nextTierReq ? Math.min((dealsCount / nextTierReq) * 100, 100) : 100;

  return {
    totalLeads: leadsCount,
    leadsByStatus: leadStatusMap,
    totalDeals: dealsCount,
    dealsThisMonth,
    totalRevenue: parseFloat(partner.totalRevenue),
    totalCommission: parseFloat(commissionsTotal._sum.amount || 0),
    pendingCommission: parseFloat(commissionsPending._sum.amount || 0),
    tier: partner.tier,
    nextTier,
    progressToNextTier,
    conversionRate: leadsCount > 0 ? ((dealsCount / leadsCount) * 100).toFixed(1) : 0,
  };
};

// Actualizar nombre del usuario
const updateUserName = async (userId, name) => {
  return prisma.user.update({
    where: { id: userId },
    data: { name },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });
};

module.exports = {
  createPartner,
  getPartnerById,
  getPartnerByCode,
  listPartners,
  updatePartner,
  updatePartnerStatus,
  updatePartnerTier,
  getPartnerStats,
  updateUserName,
};
