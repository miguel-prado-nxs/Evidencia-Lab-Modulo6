/**
 * Script de prueba para el sistema de validez temporal de cupones
 * Ejecutar con: node test-coupon-validity.js
 */

const validityService = require('./src/services/couponValidityService');

console.log('🧪 Probando Sistema de Validez Temporal de Cupones\n');

// ========== Test 1: Cupón Válido ==========
console.log('📋 Test 1: Cupón Válido');
const validCoupon = {
  code: 'VALID-COUPON',
  validFrom: new Date(Date.now() - 3600000), // Hace 1 hora
  validUntil: new Date(Date.now() + 7200000), // En 2 horas
  status: 'SENT'
};

const validity1 = validityService.checkCouponValidity(validCoupon);
console.log('Resultado:', validity1);
console.log('✅ Válido:', validity1.isValid);
console.log('⏱️  Tiempo restante:', validity1.timeRemainingFormatted);
console.log('');

// ========== Test 2: Cupón Expirado ==========
console.log('📋 Test 2: Cupón Expirado');
const expiredCoupon = {
  code: 'EXPIRED-COUPON',
  validFrom: new Date(Date.now() - 7200000), // Hace 2 horas
  validUntil: new Date(Date.now() - 3600000), // Hace 1 hora
  status: 'SENT'
};

const validity2 = validityService.checkCouponValidity(expiredCoupon);
console.log('Resultado:', validity2);
console.log('❌ Válido:', validity2.isValid);
console.log('📝 Razón:', validity2.reason);
console.log('');

// ========== Test 3: Cupón Aún No Válido ==========
console.log('📋 Test 3: Cupón Aún No Válido');
const futureCoupon = {
  code: 'FUTURE-COUPON',
  validFrom: new Date(Date.now() + 3600000), // En 1 hora
  validUntil: new Date(Date.now() + 7200000), // En 2 horas
  status: 'GENERATED'
};

const validity3 = validityService.checkCouponValidity(futureCoupon);
console.log('Resultado:', validity3);
console.log('❌ Válido:', validity3.isValid);
console.log('📝 Razón:', validity3.reason);
console.log('⏱️  Tiempo hasta válido:', validityService.formatTimeRemaining(validity3.timeUntilValid));
console.log('');

// ========== Test 4: Calcular Fechas de Validez ==========
console.log('📋 Test 4: Calcular Fechas de Validez para Template');
const template = {
  couponType: 'HAPPY_HOUR_20',
  expiresHours: 48,
  validFromHour: 17, // 5:00 PM
  validUntilHour: 21  // 9:00 PM
};

const dates = validityService.calculateCouponValidityDates(template);
console.log('Template:', template);
console.log('Fechas calculadas:');
console.log('  validFrom:', dates.validFrom.toISOString());
console.log('  validUntil:', dates.validUntil.toISOString());
console.log('  expiresAt:', dates.expiresAt.toISOString());
console.log('');

// ========== Test 5: Restricciones de Horario ==========
console.log('📋 Test 5: Verificar Restricciones de Horario');
const now = new Date();
const currentHour = now.getHours();
const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

const happyHourTemplate = {
  couponType: 'HAPPY_HOUR_30',
  validFromHour: 17,
  validUntilHour: 21,
  validDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
};

const timeRestriction = validityService.checkTemplateTimeRestrictions(happyHourTemplate);
console.log('Hora actual:', currentHour);
console.log('Día actual:', currentDay);
console.log('Template:', happyHourTemplate);
console.log('Resultado:', timeRestriction);
console.log('');

// ========== Test 6: Formateo de Tiempo ==========
console.log('📋 Test 6: Formateo de Tiempo Restante');
const times = [
  { ms: 172800000, desc: '2 días' },
  { ms: 18000000, desc: '5 horas' },
  { ms: 1800000, desc: '30 minutos' },
  { ms: 45000, desc: '45 segundos' },
  { ms: 0, desc: 'Expirado' },
  { ms: -1000, desc: 'Expirado (negativo)' }
];

times.forEach(({ ms, desc }) => {
  const formatted = validityService.formatTimeRemaining(ms);
  console.log(`  ${desc.padEnd(25)} → ${formatted}`);
});
console.log('');

// ========== Test 7: Enriquecer Cupón ==========
console.log('📋 Test 7: Enriquecer Cupón con Validez');
const couponToEnrich = {
  id: 'test-uuid',
  code: 'ENRICH-TEST',
  offer: '50% descuento',
  validFrom: new Date(Date.now() - 3600000),
  validUntil: new Date(Date.now() + 86400000), // 1 día
  status: 'SENT'
};

const enriched = validityService.enrichCouponWithValidity(couponToEnrich);
console.log('Cupón original:', {
  code: couponToEnrich.code,
  validUntil: couponToEnrich.validUntil
});
console.log('Cupón enriquecido:', {
  code: enriched.code,
  validity: enriched.validity
});
console.log('');

// ========== Test 8: Cupones Activos Ordenados ==========
console.log('📋 Test 8: Ordenar Cupones por Tiempo Restante');
const coupons = [
  {
    code: 'COUPON-A',
    validUntil: new Date(Date.now() + 7200000), // 2 horas
    status: 'SENT'
  },
  {
    code: 'COUPON-B',
    validUntil: new Date(Date.now() + 3600000), // 1 hora
    status: 'SENT'
  },
  {
    code: 'COUPON-C',
    validUntil: new Date(Date.now() + 86400000), // 1 día
    status: 'SENT'
  },
  {
    code: 'COUPON-D',
    validUntil: new Date(Date.now() - 3600000), // Expirado
    status: 'SENT'
  }
];

const activeCoupons = validityService.getActiveCouponsWithTimeRemaining(coupons);
console.log('Cupones activos ordenados por tiempo restante:');
activeCoupons.forEach((c, i) => {
  console.log(`  ${i + 1}. ${c.code} - ${c.validity.timeRemainingFormatted}`);
});
console.log('');

console.log('✅ Todas las pruebas completadas');
console.log('');
console.log('💡 Próximos pasos:');
console.log('   1. Reiniciar servidor para cargar nuevo cliente de Prisma');
console.log('   2. Probar endpoints API:');
console.log('      GET /api/v1/coupons/active-with-time');
console.log('      GET /api/v1/coupons/validate/{code}');
console.log('      POST /api/v1/coupons/mark-expired');
console.log('   3. Implementar monitor en frontend con contador en tiempo real');
