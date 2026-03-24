const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Obtener el test más reciente con sus contactos
  const latestTest = await prisma.abTest.findFirst({
    where: { name: { contains: 'Test Integración Queue' } },
    orderBy: { createdAt: 'desc' },
    include: {
      variants: {
        include: {
          contacts: {
            orderBy: { createdAt: 'desc' }
          }
        }
      }
    }
  });

  if (!latestTest) {
    console.log('No se encontró ningún test');
    return;
  }

  console.log('\n=== Test más reciente ===');
  console.log('ID:', latestTest.id);
  console.log('Nombre:', latestTest.name);
  console.log('Estado:', latestTest.status);
  console.log('Creado:', latestTest.createdAt);
  console.log('\n=== Contactos procesados ===');

  latestTest.variants.forEach((variant, idx) => {
    console.log(`\nVariante ${idx + 1} (ID: ${variant.id}):`);
    variant.contacts.forEach(contact => {
      console.log(`  - Contacto ID: ${contact.contactId}`);
      console.log(`    Estado: ${contact.status}`);
      console.log(`    Llamado: ${contact.calledAt || 'No'}`);
      if (contact.result) {
        try {
          const result = JSON.parse(contact.result);
          console.log(`    Resultado:`, JSON.stringify(result, null, 2));
        } catch (e) {
          console.log(`    Resultado (raw):`, contact.result);
        }
      } else {
        console.log(`    Sin resultado registrado`);
      }
    });
  });
}

main()
  .catch(e => {
    console.error('Error:', e.message);
    console.error(e);
  })
  .finally(() => prisma.$disconnect());
