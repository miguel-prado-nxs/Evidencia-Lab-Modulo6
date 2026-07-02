/**
 * Twenty CRM Integration
 * Exporta todos los servicios relacionados con Twenty CRM
 */

const twentyService = require('./twentyService');
const twentySyncService = require('./twentySyncService');

module.exports = {
  twentyService,
  ...twentySyncService,
};
