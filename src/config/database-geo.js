/**
 * Cliente Prisma para la base de datos de GeoInsights (Restaurantes DENUE)
 * Usa DATABASE_URL_RESTAURANTES para conectarse a la DB separada de 733K restaurantes
 */

const { PrismaClient } = require("@prisma/client");

// Usar DATABASE_URL_RESTAURANTES si existe, sino usar DATABASE_URL por defecto
const databaseUrl = process.env.DATABASE_URL_RESTAURANTES || process.env.DATABASE_URL;

const prismaGeo = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

module.exports = prismaGeo;

