const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateTemplate() {
  // Template limpio, formato correcto según el usuario
  const newTemplate = `Hola {{nombre}} 👋

Lo entiendo, muchos restaurantes empiezan con la misma duda.
Por eso te damos este cupón 👇

🎟 {{beneficio}}
Código:
{{codigo}}

Actívalo aquí: https://easyorder.mx/activate?code={{codigo}}

⏰ Válido por 48 horas`;

  await prisma.couponTemplate.update({
    where: { couponType: 'PLUS30' },
    data: { messageTemplate: newTemplate }
  });

  console.log('✅ PLUS30 template updated');
  console.log(newTemplate);

  // Actualizar también 50OFF si existe
  const t50 = await prisma.couponTemplate.findUnique({ where: { couponType: '50OFF' } });
  if (t50) {
    await prisma.couponTemplate.update({
      where: { couponType: '50OFF' },
      data: { messageTemplate: newTemplate }
    });
    console.log('\n✅ 50OFF template updated too');
  }

  await prisma.$disconnect();
}

updateTemplate().catch(console.error);
