const prisma = require('../config/database');

// Listar comisiones con filtros
const listCommissions = async (filters = {}) => {
  const {
    partnerId,
    status,
    type,
    dateFrom,
    dateTo,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = filters;

  const where = {};

  if (partnerId) where.partnerId = partnerId;
  if (status) where.status = status;
  if (type) where.type = type;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const [commissions, total] = await Promise.all([
    prisma.commission.findMany({
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
                email: true,
              },
            },
          },
        },
        deal: {
          select: {
            id: true,
            businessName: true,
            planType: true,
            totalValue: true,
          },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.commission.count({ where }),
  ]);

  return {
    data: commissions,
    total,
    page,
    pageSize: limit,
    totalPages: Math.ceil(total / limit),
  };
};

// Obtener comisiones pendientes
const getPendingCommissions = async () => {
  const commissions = await prisma.commission.findMany({
    where: { status: 'PENDING' },
    include: {
      partner: {
        select: {
          id: true,
          code: true,
          companyName: true,
          paymentMethod: true,
          paymentDetails: true,
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
      deal: {
        select: {
          id: true,
          businessName: true,
          planType: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Agrupar por partner
  const byPartner = commissions.reduce((acc, commission) => {
    const partnerId = commission.partnerId;
    if (!acc[partnerId]) {
      acc[partnerId] = {
        partner: commission.partner,
        commissions: [],
        totalAmount: 0,
      };
    }
    acc[partnerId].commissions.push(commission);
    acc[partnerId].totalAmount += parseFloat(commission.amount);
    return acc;
  }, {});

  return Object.values(byPartner);
};

// Aprobar comisiones
const approveCommissions = async (commissionIds) => {
  return prisma.commission.updateMany({
    where: {
      id: { in: commissionIds },
      status: 'PENDING',
    },
    data: {
      status: 'APPROVED',
    },
  });
};

// Marcar comisiones como pagadas
const markCommissionsAsPaid = async (commissionIds, paymentRef) => {
  const result = await prisma.$transaction(async (tx) => {
    // Actualizar comisiones
    const updated = await tx.commission.updateMany({
      where: {
        id: { in: commissionIds },
        status: { in: ['PENDING', 'APPROVED'] },
      },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paymentRef,
      },
    });

    // Obtener comisiones actualizadas para registrar actividades
    const commissions = await tx.commission.findMany({
      where: { id: { in: commissionIds } },
      include: {
        partner: true,
        deal: true,
      },
    });

    // Registrar actividades por partner
    const partnerIds = [...new Set(commissions.map((c) => c.partnerId))];
    for (const partnerId of partnerIds) {
      const partnerCommissions = commissions.filter((c) => c.partnerId === partnerId);
      const totalPaid = partnerCommissions.reduce((sum, c) => sum + parseFloat(c.amount), 0);

      await tx.activity.create({
        data: {
          partnerId,
          type: 'COMMISSION_PAID',
          description: `Pago de comisiones: $${totalPaid.toFixed(2)} MXN`,
          metadata: {
            commissionIds: partnerCommissions.map((c) => c.id),
            totalAmount: totalPaid,
            paymentRef,
          },
        },
      });

      // Actualizar commissionPaid en los deals
      for (const commission of partnerCommissions) {
        await tx.deal.update({
          where: { id: commission.dealId },
          data: {
            commissionPaid: { increment: commission.amount },
          },
        });
      }
    }

    return updated;
  });

  return result;
};

// Obtener resumen de comisiones por partner
const getCommissionSummary = async (partnerId) => {
  const [pending, approved, paid, total] = await Promise.all([
    prisma.commission.aggregate({
      where: { partnerId, status: 'PENDING' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.commission.aggregate({
      where: { partnerId, status: 'APPROVED' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.commission.aggregate({
      where: { partnerId, status: 'PAID' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.commission.aggregate({
      where: { partnerId },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  return {
    pending: {
      amount: parseFloat(pending._sum.amount || 0),
      count: pending._count,
    },
    approved: {
      amount: parseFloat(approved._sum.amount || 0),
      count: approved._count,
    },
    paid: {
      amount: parseFloat(paid._sum.amount || 0),
      count: paid._count,
    },
    total: {
      amount: parseFloat(total._sum.amount || 0),
      count: total._count,
    },
  };
};

// Obtener estadísticas globales de comisiones (Admin)
const getGlobalStats = async () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  const [pending, approved, paid, total, thisMonth, lastMonth, partnersWithPending] =
    await Promise.all([
      // Comisiones pendientes
      prisma.commission.aggregate({
        where: { status: 'PENDING' },
        _sum: { amount: true },
        _count: true,
      }),
      // Comisiones aprobadas
      prisma.commission.aggregate({
        where: { status: 'APPROVED' },
        _sum: { amount: true },
        _count: true,
      }),
      // Comisiones pagadas
      prisma.commission.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true },
        _count: true,
      }),
      // Total histórico
      prisma.commission.aggregate({
        _sum: { amount: true },
        _count: true,
      }),
      // Este mes
      prisma.commission.aggregate({
        where: {
          createdAt: { gte: startOfMonth },
        },
        _sum: { amount: true },
        _count: true,
      }),
      // Mes pasado
      prisma.commission.aggregate({
        where: {
          createdAt: {
            gte: startOfLastMonth,
            lte: endOfLastMonth,
          },
        },
        _sum: { amount: true },
        _count: true,
      }),
      // Partners con comisiones pendientes
      prisma.commission.groupBy({
        by: ['partnerId'],
        where: { status: 'PENDING' },
        _count: true,
      }),
    ]);

  return {
    pending: {
      amount: parseFloat(pending._sum.amount || 0),
      count: pending._count,
    },
    approved: {
      amount: parseFloat(approved._sum.amount || 0),
      count: approved._count,
    },
    paid: {
      amount: parseFloat(paid._sum.amount || 0),
      count: paid._count,
    },
    total: {
      amount: parseFloat(total._sum.amount || 0),
      count: total._count,
    },
    thisMonth: {
      amount: parseFloat(thisMonth._sum.amount || 0),
      count: thisMonth._count,
    },
    lastMonth: {
      amount: parseFloat(lastMonth._sum.amount || 0),
      count: lastMonth._count,
    },
    partnersWithPendingCount: partnersWithPending.length,
  };
};

// Exportar comisiones a CSV
const exportCommissions = async (filters = {}) => {
  const { partnerId, status, dateFrom, dateTo } = filters;

  const where = {};
  if (partnerId) where.partnerId = partnerId;
  if (status) where.status = status;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const commissions = await prisma.commission.findMany({
    where,
    include: {
      partner: {
        select: {
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
      deal: {
        select: {
          businessName: true,
          planType: true,
          totalValue: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return commissions;
};

module.exports = {
  listCommissions,
  getPendingCommissions,
  approveCommissions,
  markCommissionsAsPaid,
  getCommissionSummary,
  getGlobalStats,
  exportCommissions,
};
