/**
 * Reconciliación de Contactos Stuck en CALLING
 * Utilidad para detectar y corregir contactos que quedaron en estado CALLING
 */

const prisma = require("../config/database");
const logger = require("../config/logger");

/**
 * Reconcilia contactos que quedaron stuck en CALLING
 * Útil para ejecutar como tarea programada o llamada manual después de pausas
 * 
 * @param {string} campaignId - ID de la campaña a reconciliar
 * @param {object} options - Opciones de reconciliación
 * @param {number} options.timeoutMinutes - Minutos máximos esperando webhook (default: 30)
 * @param {boolean} options.markAsFailedInsteadOfPending - Marcar como FAILED en lugar de PENDING si timeout
 * @returns {Promise<object>} Reporta de reconciliación
 */
const reconcileStuckCallsInCampaign = async (
    campaignId,
    options = {}
) => {
    const {
        timeoutMinutes = 30,
        markAsFailedInsteadOfPending = false,
    } = options;

    logger.info(`[Reconciliation] Starting for campaign ${campaignId}`, {
        campaignId,
        timeoutMinutes,
        markAsFailedInsteadOfPending,
    });

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
    });

    if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
    }

    // Buscar todos los contactos en CALLING
    const stuckContacts = await prisma.campaignContact.findMany({
        where: {
            campaignId,
            status: "CALLING",
        },
        select: {
            id: true,
            establishmentId: true,
            webhookReceivedAt: true,
            conversationId: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    const report = {
        campaignId,
        totalStuck: stuckContacts.length,
        reconciled: 0,
        markedAsCallee: 0,
        markedAsPending: 0,
        markedAsFailed: 0,
        stillWaiting: 0,
        errors: [],
        details: [],
    };

    if (stuckContacts.length === 0) {
        logger.info(`[Reconciliation] No stuck contacts found for campaign ${campaignId}`);
        return report;
    }

    const now = new Date();

    for (const contact of stuckContacts) {
        try {
            const timeInCallingMs = now.getTime() - new Date(contact.updatedAt).getTime();
            const timeInCallingMinutes = timeInCallingMs / (1000 * 60);

            let action = null;
            let newStatus = null;

            // Caso 1: El webhook fue recibido → marcar como CALLED
            if (contact.webhookReceivedAt) {
                newStatus = "CALLED";
                action = "WEBHOOK_RECEIVED";
                report.markedAsCallee++;
            }
            // Caso 2: Pasó el timeout sin webhook y sin conversationId → resetear
            else if (timeInCallingMinutes > timeoutMinutes && !contact.conversationId) {
                newStatus = markAsFailedInsteadOfPending ? "FAILED" : "PENDING";
                action = markAsFailedInsteadOfPending ? "TIMEOUT_MARKED_FAILED" : "TIMEOUT_RESET_PENDING";
                if (markAsFailedInsteadOfPending) {
                    report.markedAsFailed++;
                } else {
                    report.markedAsPending++;
                }
            }
            // Caso 3: Tiene conversationId pero no webhook → esperar (sin acción)
            else if (contact.conversationId && !contact.webhookReceivedAt) {
                action = "STILL_WAITING";
                report.stillWaiting++;
            }

            // Aplicar cambio de estado si aplica
            if (newStatus) {
                await prisma.campaignContact.update({
                    where: { id: contact.id },
                    data: { status: newStatus },
                });
                report.reconciled++;
            }

            report.details.push({
                contactId: contact.id,
                establishmentId: contact.establishmentId,
                timeInCallingMinutes: Math.round(timeInCallingMinutes),
                action,
                newStatus: newStatus || contact.status,
                hasConversationId: !!contact.conversationId,
                hasWebhook: !!contact.webhookReceivedAt,
            });

            logger.debug(`[Reconciliation] Contact ${contact.id}: ${action}`, {
                timeInCallingMinutes: Math.round(timeInCallingMinutes),
                newStatus,
            });
        } catch (error) {
            report.errors.push({
                contactId: contact.id,
                error: error.message,
            });
            logger.error(`[Reconciliation] Error processing contact ${contact.id}:`, {
                error: error.message,
            });
        }
    }

    logger.info(`[Reconciliation] Completed for campaign ${campaignId}`, {
        ...report,
        detailsCount: report.details.length, // Resumen sin detalles completos en log
    });

    return report;
};

/**
 * Reconcilia TODOS los contactos stuck en todas las campañas ACTIVE
 * Útil para ejecutar como tarea programada (ej: cada 5 minutos)
 * 
 * @param {object} options - Opciones (mismo que reconcileStuckCallsInCampaign)
 * @returns {Promise<object>} Reporta agregado de todas las campañas
 */
const reconcileStuckCallsGlobal = async (options = {}) => {
    logger.info("[Reconciliation] Starting global reconciliation for all ACTIVE campaigns");

    // Obtener todas las campañas activas con contactos stuck
    const campaignsWithStuckContacts = await prisma.$queryRaw`
    SELECT DISTINCT c.id
    FROM campaigns c
    INNER JOIN campaign_contacts cc ON c.id = cc.campaign_id
    WHERE c.status = 'ACTIVE'
      AND cc.status = 'CALLING'
  `;

    const globalReport = {
        campaignsProcessed: 0,
        totalStuck: 0,
        totalReconciled: 0,
        campaignReports: [],
        timestamp: new Date().toISOString(),
    };

    for (const { id: campaignId } of campaignsWithStuckContacts) {
        try {
            const report = await reconcileStuckCallsInCampaign(campaignId, options);
            globalReport.campaignsProcessed++;
            globalReport.totalStuck += report.totalStuck;
            globalReport.totalReconciled += report.reconciled;
            globalReport.campaignReports.push(report);
        } catch (error) {
            logger.error(`[Reconciliation] Error processing campaign ${campaignId}:`, {
                error: error.message,
            });
        }
    }

    logger.info("[Reconciliation] Global reconciliation completed", {
        campaignsProcessed: globalReport.campaignsProcessed,
        totalStuck: globalReport.totalStuck,
        totalReconciled: globalReport.totalReconciled,
    });

    return globalReport;
};

module.exports = {
    reconcileStuckCallsInCampaign,
    reconcileStuckCallsGlobal,
};
