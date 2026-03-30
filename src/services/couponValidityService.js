const logger = require("../config/logger");

/**
 * Calcula si un cupón es válido en este momento según sus restricciones de tiempo
 * @param {Object} coupon - Cupón con campos validFrom, validUntil, template
 * @returns {Object} { isValid, reason, timeRemaining }
 */
const checkCouponValidity = (coupon) => {
  const now = new Date();
  
  // Verificar validFrom (fecha/hora de inicio)
  if (coupon.validFrom && now < new Date(coupon.validFrom)) {
    return {
      isValid: false,
      reason: "Cupón aún no es válido",
      startsAt: coupon.validFrom,
      timeUntilValid: new Date(coupon.validFrom) - now
    };
  }
  
  // Verificar validUntil (fecha/hora de fin)
  if (coupon.validUntil && now > new Date(coupon.validUntil)) {
    return {
      isValid: false,
      reason: "Cupón expirado",
      expiredAt: coupon.validUntil
    };
  }
  
  // Verificar expiresAt (compatibilidad con campo existente)
  if (coupon.expiresAt && now > new Date(coupon.expiresAt)) {
    return {
      isValid: false,
      reason: "Cupón expirado",
      expiredAt: coupon.expiresAt
    };
  }
  
  // Calcular tiempo restante
  let timeRemaining = null;
  let expiresAt = null;
  
  if (coupon.validUntil) {
    expiresAt = new Date(coupon.validUntil);
    timeRemaining = expiresAt - now;
  } else if (coupon.expiresAt) {
    expiresAt = new Date(coupon.expiresAt);
    timeRemaining = expiresAt - now;
  }
  
  return {
    isValid: true,
    timeRemaining,
    expiresAt,
    timeRemainingFormatted: timeRemaining ? formatTimeRemaining(timeRemaining) : null
  };
};

/**
 * Verifica si un cupón es válido según restricciones de horario del template
 * @param {Object} template - Template con validFromHour, validUntilHour, validDays
 * @returns {Object} { isValid, reason }
 */
const checkTemplateTimeRestrictions = (template) => {
  if (!template) {
    return { isValid: true };
  }
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  
  // Verificar restricción de días de la semana
  if (template.validDays && template.validDays.length > 0) {
    if (!template.validDays.includes(currentDay)) {
      return {
        isValid: false,
        reason: `Cupón solo válido en: ${template.validDays.join(', ')}`,
        currentDay
      };
    }
  }
  
  // Verificar restricción de horario
  if (template.validFromHour !== null && template.validFromHour !== undefined) {
    if (currentHour < template.validFromHour) {
      return {
        isValid: false,
        reason: `Cupón válido desde las ${template.validFromHour}:00`,
        currentHour
      };
    }
  }
  
  if (template.validUntilHour !== null && template.validUntilHour !== undefined) {
    if (currentHour >= template.validUntilHour) {
      return {
        isValid: false,
        reason: `Cupón válido hasta las ${template.validUntilHour}:00`,
        currentHour
      };
    }
  }
  
  return { isValid: true };
};

/**
 * Calcula validFrom y validUntil para un nuevo cupón basado en el template
 * @param {Object} template - Template con expiresHours, validFromHour, validUntilHour
 * @param {Date} assignedAt - Fecha de asignación del cupón
 * @returns {Object} { validFrom, validUntil }
 */
const calculateCouponValidityDates = (template, assignedAt = new Date()) => {
  const validFrom = new Date(assignedAt);
  
  // Si el template tiene restricción de hora de inicio, ajustar validFrom
  if (template.validFromHour !== null && template.validFromHour !== undefined) {
    const currentHour = validFrom.getHours();
    if (currentHour < template.validFromHour) {
      validFrom.setHours(template.validFromHour, 0, 0, 0);
    }
  }
  
  // Calcular validUntil basado en expiresHours del template
  const validUntil = new Date(assignedAt);
  validUntil.setHours(validUntil.getHours() + (template.expiresHours || 48));
  
  // Si el template tiene restricción de hora de fin, ajustar validUntil
  if (template.validUntilHour !== null && template.validUntilHour !== undefined) {
    const targetDate = new Date(validUntil);
    targetDate.setHours(template.validUntilHour, 0, 0, 0);
    
    // Si la hora de fin es antes que validUntil calculado, usar esa hora
    if (targetDate < validUntil) {
      validUntil.setHours(template.validUntilHour, 0, 0, 0);
    }
  }
  
  return {
    validFrom,
    validUntil,
    expiresAt: validUntil // Compatibilidad con campo existente
  };
};

/**
 * Formatea el tiempo restante en formato legible
 * @param {number} milliseconds - Tiempo en milisegundos
 * @returns {string} Tiempo formateado
 */
const formatTimeRemaining = (milliseconds) => {
  if (milliseconds <= 0) {
    return "Expirado";
  }
  
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
};

/**
 * Enriquece un cupón con información de validez en tiempo real
 * @param {Object} coupon - Cupón de base de datos
 * @returns {Object} Cupón enriquecido con validez
 */
const enrichCouponWithValidity = (coupon) => {
  const validity = checkCouponValidity(coupon);
  
  return {
    ...coupon,
    validity: {
      isValid: validity.isValid,
      reason: validity.reason,
      timeRemaining: validity.timeRemaining,
      timeRemainingFormatted: validity.timeRemainingFormatted,
      expiresAt: validity.expiresAt,
      startsAt: validity.startsAt
    }
  };
};

/**
 * Obtiene cupones activos con tiempo restante calculado
 * @param {Array} coupons - Array de cupones
 * @returns {Array} Cupones enriquecidos y ordenados por tiempo restante
 */
const getActiveCouponsWithTimeRemaining = (coupons) => {
  return coupons
    .map(enrichCouponWithValidity)
    .filter(c => c.validity.isValid)
    .sort((a, b) => {
      // Ordenar por tiempo restante (menor a mayor)
      if (!a.validity.timeRemaining) return 1;
      if (!b.validity.timeRemaining) return -1;
      return a.validity.timeRemaining - b.validity.timeRemaining;
    });
};

/**
 * Marca cupones expirados automáticamente
 * @param {Object} prisma - Cliente de Prisma
 * @returns {Promise<number>} Número de cupones marcados como expirados
 */
const markExpiredCoupons = async (prisma) => {
  try {
    const now = new Date();
    
    // Marcar cupones expirados por validUntil
    const result1 = await prisma.campaignCoupon.updateMany({
      where: {
        status: { in: ["GENERATED", "SENT", "VISITED"] },
        validUntil: { lte: now }
      },
      data: {
        status: "EXPIRED"
      }
    });
    
    // Marcar cupones expirados por expiresAt (campo legacy)
    const result2 = await prisma.campaignCoupon.updateMany({
      where: {
        status: { in: ["GENERATED", "SENT", "VISITED"] },
        expiresAt: { lte: now },
        validUntil: null
      },
      data: {
        status: "EXPIRED"
      }
    });
    
    const totalExpired = result1.count + result2.count;
    
    if (totalExpired > 0) {
      logger.info(`Marked ${totalExpired} coupons as expired`, {
        byValidUntil: result1.count,
        byExpiresAt: result2.count
      });
    }
    
    return totalExpired;
  } catch (error) {
    logger.error("Error marking expired coupons", { error: error.message });
    return 0;
  }
};

module.exports = {
  checkCouponValidity,
  checkTemplateTimeRestrictions,
  calculateCouponValidityDates,
  formatTimeRemaining,
  enrichCouponWithValidity,
  getActiveCouponsWithTimeRemaining,
  markExpiredCoupons
};
