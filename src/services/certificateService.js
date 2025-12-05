/**
 * Certificate Service
 * Generación de certificados PDF
 */

const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const { STORAGE_PATHS } = require("../config/storage");
const logger = require("../config/logger");

// Asegurar que existe el directorio de certificados
const CERTIFICATES_DIR = path.join(STORAGE_PATHS.resources, "certificates");
if (!fs.existsSync(CERTIFICATES_DIR)) {
  fs.mkdirSync(CERTIFICATES_DIR, { recursive: true });
}

/**
 * Generar certificado PDF
 */
async function generateCertificatePdf(certificate) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 50,
      });

      const filename = `certificate_${certificate.code}.pdf`;
      const filepath = path.join(CERTIFICATES_DIR, filename);
      const writeStream = fs.createWriteStream(filepath);

      doc.pipe(writeStream);

      // Dimensiones
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const centerX = pageWidth / 2;

      // Fondo decorativo
      doc
        .rect(30, 30, pageWidth - 60, pageHeight - 60)
        .lineWidth(3)
        .stroke("#FF8C00");

      doc
        .rect(40, 40, pageWidth - 80, pageHeight - 80)
        .lineWidth(1)
        .stroke("#FFB84D");

      // Header
      doc.fontSize(16).fillColor("#FF8C00").text("EASYORDER PARTNERS", centerX - 100, 70, {
        width: 200,
        align: "center",
      });

      // Título principal
      doc
        .fontSize(40)
        .fillColor("#333")
        .font("Helvetica-Bold")
        .text("CERTIFICADO", 0, 110, {
          width: pageWidth,
          align: "center",
        });

      doc
        .fontSize(24)
        .fillColor("#666")
        .font("Helvetica")
        .text("DE FINALIZACIÓN", 0, 155, {
          width: pageWidth,
          align: "center",
        });

      // Línea decorativa
      doc
        .moveTo(centerX - 150, 195)
        .lineTo(centerX + 150, 195)
        .lineWidth(2)
        .stroke("#FF8C00");

      // Texto principal
      doc
        .fontSize(14)
        .fillColor("#666")
        .text("Este certificado se otorga a", 0, 220, {
          width: pageWidth,
          align: "center",
        });

      // Nombre del partner
      doc
        .fontSize(32)
        .fillColor("#FF8C00")
        .font("Helvetica-Bold")
        .text(certificate.partner.user.name.toUpperCase(), 0, 250, {
          width: pageWidth,
          align: "center",
        });

      // Descripción
      doc
        .fontSize(14)
        .fillColor("#666")
        .font("Helvetica")
        .text("Por completar exitosamente el curso", 0, 300, {
          width: pageWidth,
          align: "center",
        });

      // Nombre del curso
      doc
        .fontSize(22)
        .fillColor("#333")
        .font("Helvetica-Bold")
        .text(`"${certificate.course.title}"`, 0, 325, {
          width: pageWidth,
          align: "center",
        });

      // Línea decorativa
      doc
        .moveTo(centerX - 100, 370)
        .lineTo(centerX + 100, 370)
        .lineWidth(1)
        .stroke("#DDD");

      // Fecha y código
      const formattedDate = new Date(certificate.issuedAt).toLocaleDateString("es-MX", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      doc
        .fontSize(12)
        .fillColor("#999")
        .font("Helvetica")
        .text(`Fecha de emisión: ${formattedDate}`, 0, 390, {
          width: pageWidth,
          align: "center",
        });

      doc.text(`Código de verificación: ${certificate.code}`, 0, 410, {
        width: pageWidth,
        align: "center",
      });

      // Firma placeholder
      doc
        .moveTo(centerX - 80, 470)
        .lineTo(centerX + 80, 470)
        .lineWidth(1)
        .stroke("#333");

      doc
        .fontSize(10)
        .fillColor("#666")
        .text("EasyOrder México", centerX - 50, 480, {
          width: 100,
          align: "center",
        });

      // Footer
      doc
        .fontSize(8)
        .fillColor("#999")
        .text(
          "Verifica este certificado en: https://partners.easyorder.mx/verify/" + certificate.code,
          0,
          pageHeight - 60,
          {
            width: pageWidth,
            align: "center",
          }
        );

      doc.end();

      writeStream.on("finish", () => {
        logger.info(`Certificate PDF generated: ${filepath}`);
        resolve(filepath);
      });

      writeStream.on("error", (error) => {
        logger.error("Error writing certificate PDF:", error);
        reject(error);
      });
    } catch (error) {
      logger.error("Error generating certificate PDF:", error);
      reject(error);
    }
  });
}

/**
 * Obtener ruta del certificado PDF
 */
function getCertificatePath(code) {
  return path.join(CERTIFICATES_DIR, `certificate_${code}.pdf`);
}

/**
 * Verificar si existe el PDF del certificado
 */
function certificatePdfExists(code) {
  const filepath = getCertificatePath(code);
  return fs.existsSync(filepath);
}

/**
 * Obtener URL del certificado
 */
function getCertificateUrl(code) {
  return `/api/v1/training/certificates/${code}/download`;
}

module.exports = {
  generateCertificatePdf,
  getCertificatePath,
  certificatePdfExists,
  getCertificateUrl,
  CERTIFICATES_DIR,
};

