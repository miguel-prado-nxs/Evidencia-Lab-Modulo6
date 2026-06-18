const prisma = require('../config/database');
const logger = require('../config/logger');
const { updateOpportunityStatus } = require('./twenty/twentySyncService');

// Crear nuevo lead
const createLead = async (data) => {
  const {
    partnerId,
    businessName,
    contactName,
    email,
    phone,
    businessType,
    location,
    monthlyOrders,
    interests,
    utmSource,
    utmMedium,
    utmCampaign,
    utmTerm,
    utmContent,
    landingPage,
    referrer,
    notes,
  } = data;

  // Crear lead y registrar actividad
  const lead = await prisma.$transaction(async (tx) => {
    const newLead = await tx.lead.create({
      data: {
        partnerId,
        businessName,
        contactName,
        email,
        phone,
        businessType,
        location,
        monthlyOrders,
        interests: interests || [],
        utmSource,
        utmMedium,
        utmCampaign,
        utmTerm,
        utmContent,
        landingPage,
        referrer,
        notes,
        status: 'NEW',
      },
    });

    // Actualizar contador del partner
    await tx.partner.update({
      where: { id: partnerId },
      data: {
        totalLeads: { increment: 1 },
        lastActivityAt: new Date(),
      },
    });

    // Registrar actividad
    await tx.activity.create({
      data: {
        partnerId,
        leadId: newLead.id,
        type: 'LEAD_CREATED',
        description: `Nuevo lead: ${businessName}`,
      },
    });

    return newLead;
  });

  return lead;
};

// Obtener lead por ID
const getLeadById = async (id) => {
  return prisma.lead.findUnique({
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
      deal: true,
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
};

// Listar leads con filtros
const listLeads = async (filters = {}) => {
  const {
    partnerId,
    status,
    utmCampaign,
    utmSource,
    search,
    dateFrom,
    dateTo,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = filters;

  const where = {};

  if (partnerId) where.partnerId = partnerId;
  if (status) {
    where.status = status;
  } else {
    // Por defecto, excluir clientes (WON) del listado de leads
    where.status = { not: 'WON' };
  }
  if (utmCampaign) where.utmCampaign = utmCampaign;
  if (utmSource) where.utmSource = utmSource;
  if (search) {
    where.OR = [
      { businessName: { contains: search, mode: 'insensitive' } },
      { contactName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
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
        deal: {
          select: {
            id: true,
            status: true,
            planType: true,
          },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.lead.count({ where }),
  ]);

  return {
    data: leads,
    total,
    page,
    pageSize: limit,
    totalPages: Math.ceil(total / limit),
  };
};

// Actualizar lead
const updateLead = async (id, data) => {
  return prisma.lead.update({
    where: { id },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });
};

// Cambiar status del lead
const updateLeadStatus = async (id, status, notes) => {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw new Error('Lead no encontrado');

  const updateData = { status };

  if (status === 'CONTACTED' && !lead.contactedAt) {
    updateData.contactedAt = new Date();
  }
  if (status === 'QUALIFIED' && !lead.qualifiedAt) {
    updateData.qualifiedAt = new Date();
  }

  const updatedLead = await prisma.$transaction(async (tx) => {
    const result = await tx.lead.update({
      where: { id },
      data: updateData,
    });

    await tx.activity.create({
      data: {
        partnerId: lead.partnerId,
        leadId: id,
        type: 'LEAD_STATUS_CHANGED',
        description: `Lead ${lead.businessName} cambió de ${lead.status} a ${status}`,
        metadata: notes ? { notes } : undefined,
      },
    });

    return result;
  });

  // Intentar actualizar estadoLead en Twenty CRM (non-blocking)
  // Buscar establishmentId en las notas del lead
  const establishmentIdMatch = lead.notes?.match(/ID Establecimiento: ([a-zA-Z0-9-]+)/);
  if (establishmentIdMatch) {
    const establishmentId = establishmentIdMatch[1];
    updateOpportunityStatus(establishmentId, status).catch((err) => {
      logger.warn('[LeadService] Error actualizando opportunity status en Twenty (no critico)', {
        error: err.message,
        leadId: id,
        establishmentId,
      });
    });
  }

  return updatedLead;
};

// Tracking de lead desde landing page (público)
const trackLead = async (partnerCode, leadData) => {
  // Buscar partner por código
  const partner = await prisma.partner.findUnique({
    where: { code: partnerCode },
  });

  if (!partner || partner.status !== 'ACTIVE') {
    throw new Error('Partner no encontrado o inactivo');
  }

  // Verificar si el email ya existe como lead de este partner
  const existingLead = await prisma.lead.findFirst({
    where: {
      partnerId: partner.id,
      email: leadData.email,
    },
  });

  if (existingLead) {
    // Actualizar lead existente con nuevos datos UTM si aplica
    return prisma.lead.update({
      where: { id: existingLead.id },
      data: {
        utmSource: leadData.utmSource || existingLead.utmSource,
        utmMedium: leadData.utmMedium || existingLead.utmMedium,
        utmCampaign: leadData.utmCampaign || existingLead.utmCampaign,
        utmTerm: leadData.utmTerm || existingLead.utmTerm,
        utmContent: leadData.utmContent || existingLead.utmContent,
        landingPage: leadData.landingPage || existingLead.landingPage,
        referrer: leadData.referrer || existingLead.referrer,
      },
    });
  }

  // Crear nuevo lead
  return createLead({
    partnerId: partner.id,
    ...leadData,
  });
};

module.exports = {
  createLead,
  getLeadById,
  listLeads,
  updateLead,
  updateLeadStatus,
  trackLead,
};
