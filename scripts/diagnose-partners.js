/**
 * Script de diagnóstico para verificar usuarios y partners en la BD
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:AzUkEJwarBOyavXIlBxppvyICwEtyVEB@ballast.proxy.rlwy.net:40022/railway'
    }
  }
});

async function diagnose() {
  try {
    console.log('=== USUARIOS EN LA BD ===\n');
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true },
      orderBy: { createdAt: 'asc' }
    });
    
    if (users.length === 0) {
      console.log('❌ No hay usuarios en la base de datos\n');
    } else {
      users.forEach(u => {
        console.log(`  📧 ${u.email}`);
        console.log(`     ID: ${u.id}`);
        console.log(`     Nombre: ${u.name}`);
        console.log(`     Rol: ${u.role}`);
        console.log('');
      });
    }
    
    console.log('=== PARTNERS EN LA BD ===\n');
    const partners = await prisma.partner.findMany({
      include: { 
        user: { 
          select: { email: true, name: true } 
        } 
      },
      orderBy: { createdAt: 'asc' }
    });
    
    if (partners.length === 0) {
      console.log('❌ No hay partners en la base de datos\n');
    } else {
      partners.forEach(p => {
        console.log(`  🏢 ${p.companyName || p.user?.name}`);
        console.log(`     ID: ${p.id}`);
        console.log(`     Email: ${p.user?.email}`);
        console.log(`     Código: ${p.code}`);
        console.log(`     Tipo: ${p.type}`);
        console.log(`     Status: ${p.status}`);
        console.log(`     Tier: ${p.tier}`);
        console.log('');
      });
    }

    // Verificar usuarios sin partner
    console.log('=== USUARIOS SIN PARTNER ASOCIADO ===\n');
    const usersWithoutPartner = await prisma.user.findMany({
      where: {
        partner: null,
        role: { not: 'ADMIN' }
      },
      select: { id: true, email: true, name: true, role: true }
    });

    if (usersWithoutPartner.length === 0) {
      console.log('✅ Todos los usuarios no-admin tienen partner asociado\n');
    } else {
      console.log('⚠️  Los siguientes usuarios NO tienen partner asociado:\n');
      usersWithoutPartner.forEach(u => {
        console.log(`  📧 ${u.email} (${u.role})`);
      });
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

diagnose();

