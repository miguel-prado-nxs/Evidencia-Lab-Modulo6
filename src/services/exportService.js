/**
 * Export Service
 * Maneja la exportación de datos a CSV, Excel y PDF
 */

const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { stringify } = require("csv-stringify/sync");
const prisma = require("../config/database");
const logger = require("../config/logger");

// ========================================
// Funciones de formato base
// ========================================

/**
 * Exportar a CSV
 */
function exportToCSV(data, columns) {
  const headers = columns.map((col) => col.header);
  const rows = data.map((row) =>
    columns.map((col) => {
      const value = col.accessor(row);
      return col.format ? col.format(value) : value;
    })
  );

  return stringify([headers, ...rows], {
    quoted: true,
    quoted_empty: true,
  });
}

/**
 * Exportar a Excel
 */
async function exportToExcel(data, columns, sheetName = "Datos") {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EasyOrder Partners";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);

  // Configurar columnas
  worksheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width || 15,
  }));

  // Estilo del header
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF8C00" },
  };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFF" } };

  // Agregar datos
  data.forEach((row) => {
    const rowData = {};
    columns.forEach((col) => {
      const value = col.accessor(row);
      rowData[col.key] = col.format ? col.format(value) : value;
    });
    worksheet.addRow(rowData);
  });

  // Agregar bordes
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  });

  return workbook.xlsx.writeBuffer();
}

/**
 * Exportar a PDF (tabla básica)
 */
async function exportToPDF(data, columns, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: options.landscape ? "landscape" : "portrait",
      margin: 40,
    });

    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // Header
    doc
      .fillColor("#FF8C00")
      .fontSize(20)
      .text("EasyOrder Partners", { align: "center" });
    doc
      .fillColor("#666")
      .fontSize(14)
      .text(options.title || "Reporte", { align: "center" });
    doc
      .fontSize(10)
      .text(`Generado: ${new Date().toLocaleDateString("es-MX")}`, {
        align: "center",
      });
    doc.moveDown(2);

    // Tabla simple
    const tableTop = doc.y;
    const cellPadding = 5;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columnWidth = pageWidth / columns.length;

    // Header de tabla
    doc.fillColor("#FF8C00").fontSize(9);
    columns.forEach((col, i) => {
      doc.text(col.header, doc.page.margins.left + i * columnWidth, tableTop, {
        width: columnWidth - cellPadding,
        align: "left",
      });
    });

    doc.moveDown();
    let y = doc.y;

    // Filas
    doc.fillColor("#333").fontSize(8);
    data.slice(0, 50).forEach((row, rowIndex) => {
      // Limitar a 50 filas en PDF
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      const rowY = y;
      columns.forEach((col, i) => {
        const value = col.accessor(row);
        const formatted = col.format ? col.format(value) : String(value || "");
        doc.text(formatted, doc.page.margins.left + i * columnWidth, rowY, {
          width: columnWidth - cellPadding,
          height: 20,
          ellipsis: true,
        });
      });
      y += 15;
    });

    if (data.length > 50) {
      doc.moveDown(2);
      doc
        .fillColor("#999")
        .fontSize(8)
        .text(`... y ${data.length - 50} registros más`, { align: "center" });
    }

    // Footer
    doc
      .fillColor("#999")
      .fontSize(8)
      .text(
        `Total de registros: ${data.length}`,
        doc.page.margins.left,
        doc.page.height - 50,
        { align: "center" }
      );

    doc.end();
  });
}

// ========================================
// Exportadores específicos
// ========================================

/**
 * Columnas para leads
 */
const LEADS_COLUMNS = [
  { header: "ID", key: "id", accessor: (r) => r.id, width: 30 },
  { header: "Negocio", key: "businessName", accessor: (r) => r.businessName, width: 25 },
  { header: "Contacto", key: "contactName", accessor: (r) => r.contactName, width: 20 },
  { header: "Email", key: "email", accessor: (r) => r.email, width: 25 },
  { header: "Teléfono", key: "phone", accessor: (r) => r.phone || "", width: 15 },
  { header: "Estado", key: "status", accessor: (r) => r.status, width: 12 },
  {
    header: "Valor Estimado",
    key: "estimatedValue",
    accessor: (r) => r.estimatedValue,
    format: (v) => (v ? `$${Number(v).toLocaleString("es-MX")}` : ""),
    width: 15,
  },
  { header: "UTM Source", key: "utmSource", accessor: (r) => r.utmSource || "", width: 12 },
  { header: "UTM Campaign", key: "utmCampaign", accessor: (r) => r.utmCampaign || "", width: 15 },
  {
    header: "Creado",
    key: "createdAt",
    accessor: (r) => r.createdAt,
    format: (v) => new Date(v).toLocaleDateString("es-MX"),
    width: 12,
  },
];

/**
 * Exportar leads
 */
async function exportLeads(filters = {}, format = "csv") {
  const { partnerId, status, dateFrom, dateTo } = filters;

  const where = {};
  if (partnerId) where.partnerId = partnerId;
  if (status) where.status = status;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { partner: { select: { code: true, companyName: true } } },
  });

  const columns = [...LEADS_COLUMNS];
  if (!partnerId) {
    columns.splice(1, 0, {
      header: "Partner",
      key: "partner",
      accessor: (r) => r.partner?.companyName || r.partner?.code || "",
      width: 20,
    });
  }

  switch (format) {
    case "xlsx":
      return {
        data: await exportToExcel(leads, columns, "Leads"),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: `leads_${Date.now()}.xlsx`,
      };
    case "pdf":
      return {
        data: await exportToPDF(leads, columns.slice(0, 6), {
          title: "Reporte de Leads",
          landscape: true,
        }),
        contentType: "application/pdf",
        filename: `leads_${Date.now()}.pdf`,
      };
    default:
      return {
        data: exportToCSV(leads, columns),
        contentType: "text/csv",
        filename: `leads_${Date.now()}.csv`,
      };
  }
}

/**
 * Columnas para comisiones
 */
const COMMISSIONS_COLUMNS = [
  { header: "ID", key: "id", accessor: (r) => r.id, width: 30 },
  { header: "Tipo", key: "type", accessor: (r) => r.type, width: 15 },
  {
    header: "Monto",
    key: "amount",
    accessor: (r) => r.amount,
    format: (v) => `$${Number(v).toLocaleString("es-MX")}`,
    width: 12,
  },
  { header: "Moneda", key: "currency", accessor: (r) => r.currency, width: 8 },
  { header: "Estado", key: "status", accessor: (r) => r.status, width: 12 },
  { header: "Negocio", key: "businessName", accessor: (r) => r.deal?.businessName || "", width: 25 },
  {
    header: "Periodo Inicio",
    key: "periodStart",
    accessor: (r) => r.periodStart,
    format: (v) => (v ? new Date(v).toLocaleDateString("es-MX") : ""),
    width: 12,
  },
  {
    header: "Periodo Fin",
    key: "periodEnd",
    accessor: (r) => r.periodEnd,
    format: (v) => (v ? new Date(v).toLocaleDateString("es-MX") : ""),
    width: 12,
  },
  {
    header: "Pagado",
    key: "paidAt",
    accessor: (r) => r.paidAt,
    format: (v) => (v ? new Date(v).toLocaleDateString("es-MX") : ""),
    width: 12,
  },
  { header: "Ref. Pago", key: "paymentRef", accessor: (r) => r.paymentRef || "", width: 15 },
  {
    header: "Creado",
    key: "createdAt",
    accessor: (r) => r.createdAt,
    format: (v) => new Date(v).toLocaleDateString("es-MX"),
    width: 12,
  },
];

/**
 * Exportar comisiones
 */
async function exportCommissions(filters = {}, format = "csv") {
  const { partnerId, status, type, dateFrom, dateTo } = filters;

  const where = {};
  if (partnerId) where.partnerId = partnerId;
  if (status) where.status = status;
  if (type) where.type = type;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const commissions = await prisma.commission.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      deal: { select: { businessName: true } },
      partner: { select: { code: true, companyName: true } },
    },
  });

  const columns = [...COMMISSIONS_COLUMNS];
  if (!partnerId) {
    columns.splice(1, 0, {
      header: "Partner",
      key: "partner",
      accessor: (r) => r.partner?.companyName || r.partner?.code || "",
      width: 20,
    });
  }

  switch (format) {
    case "xlsx":
      return {
        data: await exportToExcel(commissions, columns, "Comisiones"),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: `commissions_${Date.now()}.xlsx`,
      };
    case "pdf":
      return {
        data: await exportToPDF(commissions, columns.slice(0, 6), {
          title: "Reporte de Comisiones",
        }),
        contentType: "application/pdf",
        filename: `commissions_${Date.now()}.pdf`,
      };
    default:
      return {
        data: exportToCSV(commissions, columns),
        contentType: "text/csv",
        filename: `commissions_${Date.now()}.csv`,
      };
  }
}

/**
 * Columnas para partners
 */
const PARTNERS_COLUMNS = [
  { header: "Código", key: "code", accessor: (r) => r.code, width: 12 },
  { header: "Nombre", key: "name", accessor: (r) => r.user?.name || "", width: 20 },
  { header: "Email", key: "email", accessor: (r) => r.user?.email || "", width: 25 },
  { header: "Empresa", key: "companyName", accessor: (r) => r.companyName || "", width: 25 },
  { header: "Tipo", key: "type", accessor: (r) => r.type, width: 12 },
  { header: "Tier", key: "tier", accessor: (r) => r.tier, width: 12 },
  { header: "Estado", key: "status", accessor: (r) => r.status, width: 12 },
  {
    header: "Comisión %",
    key: "commissionRate",
    accessor: (r) => r.commissionRate,
    format: (v) => `${(Number(v) * 100).toFixed(0)}%`,
    width: 10,
  },
  { header: "Total Leads", key: "totalLeads", accessor: (r) => r.totalLeads, width: 10 },
  { header: "Total Deals", key: "totalDeals", accessor: (r) => r.totalDeals, width: 10 },
  {
    header: "Revenue Total",
    key: "totalRevenue",
    accessor: (r) => r.totalRevenue,
    format: (v) => `$${Number(v).toLocaleString("es-MX")}`,
    width: 15,
  },
  {
    header: "Comisiones",
    key: "totalCommission",
    accessor: (r) => r.totalCommission,
    format: (v) => `$${Number(v).toLocaleString("es-MX")}`,
    width: 15,
  },
  {
    header: "Creado",
    key: "createdAt",
    accessor: (r) => r.createdAt,
    format: (v) => new Date(v).toLocaleDateString("es-MX"),
    width: 12,
  },
];

/**
 * Exportar partners (admin only)
 */
async function exportPartners(filters = {}, format = "csv") {
  const { type, tier, status, dateFrom, dateTo } = filters;

  const where = {};
  if (type) where.type = type;
  if (tier) where.tier = tier;
  if (status) where.status = status;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const partners = await prisma.partner.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  });

  switch (format) {
    case "xlsx":
      return {
        data: await exportToExcel(partners, PARTNERS_COLUMNS, "Partners"),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: `partners_${Date.now()}.xlsx`,
      };
    case "pdf":
      return {
        data: await exportToPDF(partners, PARTNERS_COLUMNS.slice(0, 7), {
          title: "Reporte de Partners",
          landscape: true,
        }),
        contentType: "application/pdf",
        filename: `partners_${Date.now()}.pdf`,
      };
    default:
      return {
        data: exportToCSV(partners, PARTNERS_COLUMNS),
        contentType: "text/csv",
        filename: `partners_${Date.now()}.csv`,
      };
  }
}

/**
 * Exportar deals
 */
async function exportDeals(filters = {}, format = "csv") {
  const { partnerId, status, dateFrom, dateTo } = filters;

  const where = {};
  if (partnerId) where.partnerId = partnerId;
  if (status) where.status = status;
  if (dateFrom || dateTo) {
    where.closedAt = {};
    if (dateFrom) where.closedAt.gte = new Date(dateFrom);
    if (dateTo) where.closedAt.lte = new Date(dateTo);
  }

  const deals = await prisma.deal.findMany({
    where,
    orderBy: { closedAt: "desc" },
    include: {
      partner: { select: { code: true, companyName: true } },
      lead: { select: { contactName: true, email: true } },
    },
  });

  const columns = [
    { header: "ID", key: "id", accessor: (r) => r.id, width: 30 },
    { header: "Negocio", key: "businessName", accessor: (r) => r.businessName, width: 25 },
    { header: "Plan", key: "planType", accessor: (r) => r.planType, width: 12 },
    {
      header: "Precio Plan",
      key: "planPrice",
      accessor: (r) => r.planPrice,
      format: (v) => `$${Number(v).toLocaleString("es-MX")}`,
      width: 12,
    },
    {
      header: "Valor Total",
      key: "totalValue",
      accessor: (r) => r.totalValue,
      format: (v) => `$${Number(v).toLocaleString("es-MX")}`,
      width: 15,
    },
    {
      header: "Comisión",
      key: "commissionAmount",
      accessor: (r) => r.commissionAmount,
      format: (v) => `$${Number(v).toLocaleString("es-MX")}`,
      width: 12,
    },
    { header: "Estado", key: "status", accessor: (r) => r.status, width: 12 },
    {
      header: "Cerrado",
      key: "closedAt",
      accessor: (r) => r.closedAt,
      format: (v) => new Date(v).toLocaleDateString("es-MX"),
      width: 12,
    },
  ];

  if (!partnerId) {
    columns.splice(1, 0, {
      header: "Partner",
      key: "partner",
      accessor: (r) => r.partner?.companyName || r.partner?.code || "",
      width: 20,
    });
  }

  switch (format) {
    case "xlsx":
      return {
        data: await exportToExcel(deals, columns, "Deals"),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: `deals_${Date.now()}.xlsx`,
      };
    case "pdf":
      return {
        data: await exportToPDF(deals, columns.slice(0, 6), {
          title: "Reporte de Ventas",
        }),
        contentType: "application/pdf",
        filename: `deals_${Date.now()}.pdf`,
      };
    default:
      return {
        data: exportToCSV(deals, columns),
        contentType: "text/csv",
        filename: `deals_${Date.now()}.csv`,
      };
  }
}

/**
 * Generar reporte completo de partner (PDF)
 */
async function generatePartnerReport(partnerId) {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    include: {
      user: { select: { name: true, email: true } },
      _count: { select: { leads: true, deals: true, commissions: true } },
    },
  });

  if (!partner) throw new Error("Partner no encontrado");

  // Obtener estadísticas
  const [leadsByStatus, commissionStats] = await Promise.all([
    prisma.lead.groupBy({
      by: ["status"],
      where: { partnerId },
      _count: { status: true },
    }),
    prisma.commission.aggregate({
      where: { partnerId },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    // Header
    doc.fillColor("#FF8C00").fontSize(24).text("EasyOrder Partners", { align: "center" });
    doc.fillColor("#333").fontSize(18).text("Reporte de Partner", { align: "center" });
    doc.moveDown(2);

    // Info del partner
    doc.fillColor("#FF8C00").fontSize(14).text("Información del Partner");
    doc.fillColor("#333").fontSize(11);
    doc.text(`Código: ${partner.code}`);
    doc.text(`Nombre: ${partner.user.name}`);
    doc.text(`Email: ${partner.user.email}`);
    doc.text(`Empresa: ${partner.companyName || "N/A"}`);
    doc.text(`Tipo: ${partner.type}`);
    doc.text(`Tier: ${partner.tier}`);
    doc.text(`Estado: ${partner.status}`);
    doc.text(`Comisión: ${(Number(partner.commissionRate) * 100).toFixed(0)}%`);
    doc.moveDown(2);

    // Estadísticas
    doc.fillColor("#FF8C00").fontSize(14).text("Estadísticas");
    doc.fillColor("#333").fontSize(11);
    doc.text(`Total Leads: ${partner._count.leads}`);
    doc.text(`Total Deals: ${partner._count.deals}`);
    doc.text(`Total Comisiones: ${partner._count.commissions}`);
    doc.text(`Revenue Total: $${Number(partner.totalRevenue).toLocaleString("es-MX")}`);
    doc.text(`Comisiones Totales: $${Number(commissionStats._sum.amount || 0).toLocaleString("es-MX")}`);
    doc.moveDown(2);

    // Leads por estado
    doc.fillColor("#FF8C00").fontSize(14).text("Leads por Estado");
    doc.fillColor("#333").fontSize(11);
    leadsByStatus.forEach((item) => {
      doc.text(`${item.status}: ${item._count.status}`);
    });

    // Footer
    doc
      .fillColor("#999")
      .fontSize(8)
      .text(
        `Generado el ${new Date().toLocaleString("es-MX")}`,
        40,
        doc.page.height - 50,
        { align: "center" }
      );

    doc.end();
  });
}

module.exports = {
  exportToCSV,
  exportToExcel,
  exportToPDF,
  exportLeads,
  exportCommissions,
  exportPartners,
  exportDeals,
  generatePartnerReport,
};

