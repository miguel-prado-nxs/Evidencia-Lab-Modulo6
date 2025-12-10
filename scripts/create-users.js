/**
 * Script para crear usuarios admin y partner
 * 
 * Uso: node scripts/create-users.js
 */

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:AzUkEJwarBOyavXIlBxppvyICwEtyVEB@ballast.proxy.rlwy.net:40022/railway'
    }
  }
});

// Función para generar código único de partner
function generatePartnerCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'EO-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function createUsers() {
  try {
    console.log('🚀 Iniciando creación de usuarios...\n');

    // ========== CREAR ADMIN ==========
    const adminEmail = 'admin@easyorder.mx';
    const adminPassword = 'Admin123!';
    const adminName = 'Administrador EasyOrder';

    console.log('📌 Procesando usuario ADMIN:', adminEmail);
    
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail }
    });

    if (existingAdmin) {
      // Actualizar contraseña y asegurar rol ADMIN
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      const updated = await prisma.user.update({
        where: { email: adminEmail },
        data: { 
          passwordHash,
          role: 'ADMIN',
          emailVerified: new Date()
        }
      });
      console.log('   ✅ Usuario ADMIN actualizado');
      console.log('   ID:', updated.id);
      console.log('   Contraseña actualizada: Admin123!\n');
    } else {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      const admin = await prisma.user.create({
        data: {
          email: adminEmail,
          name: adminName,
          passwordHash,
          role: 'ADMIN',
          emailVerified: new Date()
        }
      });
      console.log('   ✅ Usuario ADMIN creado');
      console.log('   ID:', admin.id);
      console.log('   Contraseña: Admin123!\n');
    }

    // ========== CREAR PARTNER ==========
    const partnerEmail = 'ventas@easyorder.mx';
    const partnerPassword = 'Nexgen2025.';
    const partnerName = 'Ventas EasyOrder';

    console.log('📌 Procesando usuario PARTNER:', partnerEmail);

    const existingPartner = await prisma.user.findUnique({
      where: { email: partnerEmail },
      include: { partner: true }
    });

    if (existingPartner) {
      // Actualizar contraseña
      const passwordHash = await bcrypt.hash(partnerPassword, 10);
      const updated = await prisma.user.update({
        where: { email: partnerEmail },
        data: { 
          passwordHash,
          role: 'PARTNER',
          emailVerified: new Date()
        }
      });
      console.log('   ✅ Usuario PARTNER actualizado');
      console.log('   ID:', updated.id);
      console.log('   Contraseña actualizada: Nexgen2025.');
      
      if (existingPartner.partner) {
        console.log('   Partner ID:', existingPartner.partner.id);
        console.log('   Código:', existingPartner.partner.code);
      }
      console.log('');
    } else {
      const passwordHash = await bcrypt.hash(partnerPassword, 10);
      const partnerCode = generatePartnerCode();
      
      const partner = await prisma.user.create({
        data: {
          email: partnerEmail,
          name: partnerName,
          passwordHash,
          role: 'PARTNER',
          emailVerified: new Date(),
          partner: {
            create: {
              code: partnerCode,
              type: 'AFFILIATE',
              tier: 'REGISTERED',
              status: 'ACTIVE',
              companyName: 'EasyOrder Ventas',
              commissionRate: 0.15,
              referralLink: `https://easyorder.mx/?ref=${partnerCode}`,
            }
          }
        },
        include: { partner: true }
      });
      console.log('   ✅ Usuario PARTNER creado');
      console.log('   ID:', partner.id);
      console.log('   Partner ID:', partner.partner.id);
      console.log('   Código:', partner.partner.code);
      console.log('   Contraseña: Nexgen2025.\n');
    }

    console.log('🎉 Proceso completado exitosamente!');
    console.log('\n📋 Resumen de credenciales:');
    console.log('   ADMIN: admin@easyorder.mx / Admin123!');
    console.log('   PARTNER: ventas@easyorder.mx / Nexgen2025.');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 'P2002') {
      console.error('   Conflicto de unicidad en la base de datos.');
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
createUsers()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script fallido:', error.message);
    process.exit(1);
  });


