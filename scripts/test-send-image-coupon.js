/**
 * Script para actualizar template con imagen de Picsum y enviar mensaje de prueba
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateAndTest() {
  console.log('🧪 Actualizando template y preparando prueba...\n');

  try {
    // 1. Actualizar template PLUS30 con imagen de Picsum
    console.log('1️⃣ Actualizando template PLUS30 con imagen de Picsum...');
    const updated = await prisma.couponTemplate.update({
      where: { couponType: 'PLUS30' },
      data: { 
        mediaUrl: 'https://picsum.photos/800/600'
      }
    });

    console.log('✅ Template actualizado:');
    console.log(`   Tipo: ${updated.couponType}`);
    console.log(`   Nombre: ${updated.name}`);
    console.log(`   Media URL: ${updated.mediaUrl}`);

    // 2. Verificar el template
    console.log('\n2️⃣ Verificando template...');
    const template = await prisma.couponTemplate.findUnique({
      where: { couponType: 'PLUS30' },
      select: {
        couponType: true,
        name: true,
        messageTemplate: true,
        mediaUrl: true,
        percentOff: true,
        durationMonths: true
      }
    });

    console.log('✅ Template verificado:');
    console.log(JSON.stringify(template, null, 2));

    // 3. Mostrar instrucciones para enviar
    console.log('\n3️⃣ Para enviar el mensaje de prueba, usa Postman o curl:\n');
    
    const testPayload = {
      phone: "523891234567", // Número de prueba
      prospectName: "Test User",
      businessName: "Test Business",
      couponType: "PLUS30",
      scenario: "interested",
      agentId: "test_agent",
      callId: "test_call_" + Date.now()
    };

    console.log('📮 Endpoint:');
    console.log('   POST http://localhost:3000/api/v1/coupons-whatsapp/generate-and-send');
    console.log('\n📋 Headers:');
    console.log('   X-API-KEY: tu_api_key');
    console.log('   Content-Type: application/json');
    console.log('\n📦 Body:');
    console.log(JSON.stringify(testPayload, null, 2));

    console.log('\n🔧 Comando curl:');
    console.log(`
curl -X POST http://localhost:3000/api/v1/coupons-whatsapp/generate-and-send \\
  -H "Content-Type: application/json" \\
  -H "X-API-KEY: tu_api_key" \\
  -d '${JSON.stringify(testPayload)}'
    `);

    console.log('\n✅ Template listo para prueba con imagen!');
    console.log('📱 El mensaje incluirá la imagen de Picsum (800x600)');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

updateAndTest();
