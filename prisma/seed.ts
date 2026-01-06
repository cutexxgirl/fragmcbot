import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log(`Start seeding ...`);

  const builds = [
    { name: 'Fragment', codeName: 'fragment', description: 'Основная сборка' },
    { name: 'Pulse', codeName: 'pulse', description: 'Дополнительная сборка #1' },
    { name: 'Gear&Wire', codeName: 'gearwire', description: 'Дополнительная сборка #2' },
    { name: 'Ouch', codeName: 'ouch', description: 'Дополнительная сборка #3' },
  ];

  for (const b of builds) {
    const existing = await prisma.build.findUnique({ where: { codeName: b.codeName } });
    if (!existing) {
      await prisma.build.create({ data: b });
      console.log(`Created build: ${b.name}`);
    }
  }

  console.log(`Seeding finished.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });