/**
 * Cliente Prisma para la base de datos de GeoInsights (Restaurantes DENUE)
 * Usa DATABASE_URL_RESTAURANTES para conectarse a la DB separada de 800k+ restaurantes
 *
 * IMPORTANTE: Este cliente usa un esquema Prisma separado (prisma/schema-geo.prisma)
 * que define los modelos de la base de datos de Mapa/Geo
 */

// Importar el cliente generado desde la ubicación del esquema geo
const { PrismaClient } = require("@prisma/client-geo");

const prismaGeo = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

module.exports = prismaGeo;
