const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:AzUkEJwarBOyavXIlBxppvyICwEtyVEB@ballast.proxy.rlwy.net:40022/railway'
    }
  }
});

async function createUser() {
  try {
    const passwordHash = await bcrypt.hash('Admin123!', 10);
    
    // Verificar si el usuario ya existe
    const existing = await prisma.user.findUnique({
      where: { email: 'ventas@easyorder.mx' }
    });
    
    if (existing) {
      console.log('✅ Usuario ya existe:', existing.email);
      console.log('   ID:', existing.id);
      console.log('   Role:', existing.role);
      return existing;
    }
    
    const user = await prisma.user.create({
      data: {
        email: 'ventas@easyorder.mx',
        name: 'Ventas EasyOrder',
        passwordHash: passwordHash,
        role: 'PARTNER',
        emailVerified: null
      }
    });
    
    console.log('✅ Usuario creado exitosamente:');
    console.log('   Email:', user.email);
    console.log('   ID:', user.id);
    console.log('   Role:', user.role);
    return user;
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

createUser();

