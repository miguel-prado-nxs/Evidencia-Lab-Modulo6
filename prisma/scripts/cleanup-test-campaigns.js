/**
 * Elimina campanas de prueba de la BD.
 * Conserva SOLO las campanas reales (REAL_NAMES).
 * CampaignContact y CampaignCoupon se borran en cascada.
 *
 * Uso:
 *   node prisma/scripts/cleanup-test-campaigns.js            # ejecucion real
 *   node prisma/scripts/cleanup-test-campaigns.js --dry-run  # solo reporta
 */

require('dotenv').config();
const prisma = require('../../src/config/database');

const DRY_RUN = process.argv.includes('--dry-run');

const REAL_NAMES = [
  'Queen Elizabeth The First (Discovery campaign w/CSV)',
  'Queen Elizabeth The Second',
];

async function run() {
  console.log(`[cleanup-test-campaigns] Modo: ${DRY_RUN ? 'DRY-RUN' : 'REAL'}`);

  // Campanas a eliminar: todas excepto las reales
  const toDelete = await prisma.campaign.findMany({
    where: { name: { notIn: REAL_NAMES } },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      _count: { select: { contacts: true, coupons: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Campanas que se conservan (verificacion)
  const toKeep = await prisma.campaign.findMany({
    where: { name: { in: REAL_NAMES } },
    select: { id: true, name: true, _count: { select: { contacts: true } } },
  });

  console.log(`\n[cleanup-test-campaigns] Campanas a CONSERVAR (${toKeep.length}):`);
  toKeep.forEach(c => console.log(`  - "${c.name}" | ${c._count.contacts} contactos`));

  console.log(`\n[cleanup-test-campaigns] Campanas a ELIMINAR: ${toDelete.length}`);
  const totalContacts = toDelete.reduce((s, c) => s + c._count.contacts, 0);
  const totalCoupons = toDelete.reduce((s, c) => s + c._count.coupons, 0);
  console.log(`  Contactos que se borran en cascada: ${totalContacts}`);
  console.log(`  Cupones que se borran en cascada:   ${totalCoupons}`);

  if (DRY_RUN) {
    console.log('\n[cleanup-test-campaigns] DRY-RUN — nada fue eliminado.');
    await prisma.$disconnect();
    return;
  }

  console.log('\n[cleanup-test-campaigns] Eliminando...');
  const result = await prisma.campaign.deleteMany({
    where: { name: { notIn: REAL_NAMES } },
  });

  console.log(`[cleanup-test-campaigns] Eliminadas: ${result.count} campanas`);
  console.log(`[cleanup-test-campaigns] Contactos y cupones eliminados en cascada.`);

  // Verificacion final
  const remaining = await prisma.campaign.count();
  console.log(`[cleanup-test-campaigns] Campanas restantes en BD: ${remaining}`);

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error('[cleanup-test-campaigns] Error fatal:', err.message);
  prisma.$disconnect();
  process.exit(1);
});
