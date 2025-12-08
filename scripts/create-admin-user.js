/**
 * Script para crear o actualizar el usuario administrador
 * 
 * Uso: node scripts/create-admin-user.js
 * 
 * Este script:
 * 1. Verifica si el usuario admin@easyorder.mx ya existe
 * 2. Si existe: actualiza su rol a ADMIN
 * 3. Si no existe: crea el usuario con rol ADMIN
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

async function createOrUpdateAdmin() {
  const email = 'admin@easyorder.mx';
  const password = 'Admin123!'; // Contraseña por defecto - cambiar en producción
  const name = 'Administrador EasyOrder';

  try {
    console.log('🔍 Buscando usuario:', email);
    
    // Verificar si el usuario ya existe
    const existing = await prisma.user.findUnique({
      where: { email }
    });

    if (existing) {
      console.log('📌 Usuario encontrado:');
      console.log('   ID:', existing.id);
      console.log('   Nombre:', existing.name);
      console.log('   Rol actual:', existing.role);

      if (existing.role === 'ADMIN') {
        console.log('\n✅ El usuario ya tiene rol ADMIN. No se requieren cambios.');
        return existing;
      }

      // Actualizar rol a ADMIN
      const updated = await prisma.user.update({
        where: { email },
        data: { role: 'ADMIN' }
      });

      console.log('\n✅ Usuario actualizado a ADMIN exitosamente:');
      console.log('   Email:', updated.email);
      console.log('   ID:', updated.id);
      console.log('   Rol anterior:', existing.role);
      console.log('   Rol nuevo:', updated.role);
      return updated;
    }

    // Usuario no existe, crear nuevo
    console.log('📌 Usuario no encontrado. Creando nuevo usuario admin...');
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'ADMIN',
        emailVerified: new Date()
      }
    });

    console.log('\n✅ Usuario ADMIN creado exitosamente:');
    console.log('   Email:', user.email);
    console.log('   ID:', user.id);
    console.log('   Nombre:', user.name);
    console.log('   Rol:', user.role);
    console.log('\n⚠️  Contraseña temporal: Admin123!');
    console.log('   ¡Recuerda cambiarla después del primer login!');
    
    return user;
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 'P2002') {
      console.error('   El email ya existe en la base de datos.');
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
createOrUpdateAdmin()
  .then(() => {
    console.log('\n🎉 Script completado.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script fallido:', error.message);
    process.exit(1);
  });

