const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function createTestUser() {
  try {
    const email = 'test-campaigns@easyorder.mx';
    const password = 'Test1234!';
    
    console.log('🔍 Verificando si el usuario ya existe...');
    
    const existing = await prisma.user.findUnique({
      where: { email },
      include: { partner: true },
    });

    if (existing) {
      console.log('⚠️  El usuario ya existe. Eliminando...');
      if (existing.partner) {
        await prisma.partner.delete({
          where: { id: existing.partner.id },
        });
      }
      await prisma.user.delete({
        where: { id: existing.id },
      });
      console.log('✅ Usuario anterior eliminado');
    }

    console.log('🔐 Generando hash de contraseña...');
    const passwordHash = await bcrypt.hash(password, 10);

    console.log('👤 Creando usuario y partner...');
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: 'Test Campaigns User',
          role: 'ADMIN',
          emailVerified: new Date(),
        },
      });

      const code = `TEST-${uuidv4().substring(0, 6).toUpperCase()}`;
      const partner = await tx.partner.create({
        data: {
          userId: user.id,
          code,
          type: 'TECHNOLOGY',
          tier: 'ELITE',
          status: 'ACTIVE',
          companyName: 'Test Campaigns Company',
          contactName: 'Test User',
          contactEmail: email,
          commissionRate: 0.15,
          referralLink: `https://easyorder.mx/?ref=${code}`,
        },
      });

      return { user, partner };
    });

    console.log('');
    console.log('✅ ¡Usuario de prueba creado exitosamente!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('📧 Email:    ', email);
    console.log('🔑 Password: ', password);
    console.log('👤 Role:     ', result.user.role);
    console.log('🆔 User ID:  ', result.user.id);
    console.log('🏢 Partner:  ', result.partner.code);
    console.log('📊 Status:   ', result.partner.status);
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('🧪 Prueba el login con PowerShell:');
    console.log('');
    console.log('$response = Invoke-RestMethod -Uri "http://localhost:3004/api/v1/auth/login" `');
    console.log('  -Method Post `');
    console.log('  -ContentType "application/json" `');
    console.log(`  -Body '{"email": "${email}", "password": "${password}"}'`);
    console.log('');
    console.log('$token = $response.data.token');
    console.log('Write-Host "Token: $token"');
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('📋 Luego prueba las campañas:');
    console.log('');
    console.log('# Listar campañas');
    console.log('Invoke-RestMethod -Uri "http://localhost:3004/api/v1/campaigns" `');
    console.log('  -Method Get `');
    console.log('  -Headers @{"Authorization"="Bearer $token"}');
    console.log('');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestUser();
