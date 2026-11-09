import { prisma } from '../lib/prisma.js';

const EXCEL_CODES = [
  '90', '246', '514', '235', '46',
  '121', '186', '119', '398', '735',
  '534', '736', '55', '236', '692',
  '693', '472', '546', '183', '86',
  '48', '732', '632', '484', '630'
];

async function main() {
  const isApply = process.argv.includes('--apply');

  const allProducts = await prisma.fertilizerProduct.findMany({
    include: {
      movements: true,
      workMaterials: true,
    },
    orderBy: { name: 'asc' },
  });

  const toDelete = allProducts.filter((p) => !p.code || !EXCEL_CODES.includes(p.code));
  const toKeep = allProducts.filter((p) => p.code && EXCEL_CODES.includes(p.code));

  console.log(`Ukupno u bazi: ${allProducts.length}`);
  console.log(`Zadržavamo (iz Excel tabele): ${toKeep.length}`);
  console.log(`Za brisanje (nisu u Excel tabeli): ${toDelete.length}`);

  console.log('\nArtikli koji se brišu:');
  for (const p of toDelete) {
    console.log(` - [${p.code || 'BEZ ŠIFRE'}] ${p.name} (movements: ${p.movements.length}, workMaterials: ${p.workMaterials.length})`);
  }

  if (!isApply) {
    console.log('\nDRY RUN: Pokrenite sa --apply za stvarno brisanje.');
    process.exit(0);
  }

  console.log('\nBrišem stavke iz baze...');
  for (const p of toDelete) {
    if (p.movements.length > 0) {
      await prisma.fertilizerMovement.deleteMany({
        where: { productId: p.id },
      });
      console.log(` - Obrisano ${p.movements.length} kretanja za ${p.name}`);
    }
    if (p.workMaterials.length > 0) {
      await prisma.workMaterial.deleteMany({
        where: { fertilizerId: p.id },
      });
      console.log(` - Obrisano ${p.workMaterials.length} radnih materijala za ${p.name}`);
    }
    await prisma.fertilizerProduct.delete({
      where: { id: p.id },
    });
    console.log(` - Obrisan proizvod: ${p.name}`);
  }

  const remaining = await prisma.fertilizerProduct.findMany({
    orderBy: { code: 'asc' },
  });

  console.log(`\nZavršeno! Preostalo artikala u bazi: ${remaining.length}`);
  remaining.forEach((r) => {
    console.log(` [${r.code}] ${r.name} (${r.type}, ${r.unit})`);
  });

  process.exit(0);
}

main().catch((err) => {
  console.error('Greška:', err);
  process.exit(1);
});

