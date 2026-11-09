import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../lib/prisma.js';

const require = createRequire(import.meta.url);
const xlsx = require('../../frontend/node_modules/xlsx');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXCEL_PATH = path.resolve(__dirname, '../../Seme, djubrivo, hemija.XLS');

// Mappings & descriptions for domain quality
const FERTILIZER_DETAILS = {
  '90': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Amonijum nitrat (34.4% N) azotno mineralno đubrivo za prihranu (vreća 25kg)',
  },
  '246': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Amonijum nitrat (34.4% N) u džambo vrećama (Big Bag) za mašinsko rasipanje',
  },
  '514': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Specijalno NP mineralno đubrivo sa biostimulativnim kompleksom za povrće i luk (50kg)',
  },
  '235': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Kompleksno NPK đubrivo sa Physiomax kompleksom u džambo vrećama (600kg)',
  },
  '46': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Kompleksno NP mineralno đubrivo sa sumporom i mikroelementima (Big Bag 600kg)',
  },
  '121': {
    type: 'TECNI_BIOSTIMULATOR',
    unit: 'L',
    description: 'Tečni biostimulator za ukorenjavanje i početni porast useva (kanister 20L)',
  },
  '186': {
    type: 'TECNI_BIOSTIMULATOR',
    unit: 'L',
    description: 'Folijarni biostimulator sa cinkom, manganom i fosforom Seactiv (pakovanje 5L)',
  },
  '119': {
    type: 'TECNI_BIOSTIMULATOR',
    unit: 'L',
    description: 'Folijarni biostimulator sa borom i molibdenom za cvetanje i zametanje (pakovanje 60L)',
  },
  '398': {
    type: 'VODOTOPIVO_FERTIRIGACIJA',
    unit: 'KG',
    description: 'Vodotopivo NPK đubrivo sa Phytactyl kompleksom za fertirigaciju kap-po-kap (25kg)',
  },
  '735': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Mikronizovano disperzivno sumporno đubrivo / korektor zemljišta (25kg)',
  },
  '534': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Starter đubrivo visoke koncentracije fosfora za rani razvoj korenovog sistema (25kg)',
  },
  '736': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Kompleksno mineralno đubrivo sa visokim sadržajem fosfora i kalijuma (25kg)',
  },
  '55': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Univerzalno NPK mineralno đubrivo ujednačenog odnosa hraniva (25kg)',
  },
  '236': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Kompleksno NPK đubrivo sa pojačanim kalijumom u džambo vrećama (Big Bag 600kg)',
  },
  '692': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Mineralno đubrivo sa 30% kalijuma idealno za luk i korenasto povrće (25kg)',
  },
  '693': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Mineralno đubrivo NPK 8-20-30 u džambo vrećama (Big Bag 600kg)',
  },
  '472': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'SQM kalijum-nitratno granulirano đubrivo bez hlora za intenzivno povrtarstvo (25kg)',
  },
  '546': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Azotno-sumporno đubrivo (25% N + 32% SO3) sa MPPA kompleksom (vreća 40kg)',
  },
  '183': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Azotno-sumporno đubrivo u džambo vrećama 1000kg (Big Bag 1t)',
  },
  '86': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Koncentrovano azotno đubrivo (46% N) za osnovno đubrenje i prihranu (vreća 25kg)',
  },
  '48': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Koncentrovano azotno đubrivo (46% N) u džambo vrećama (Big Bag 500kg)',
  },
  '732': {
    type: 'TECNI_BIOSTIMULATOR',
    unit: 'L',
    description: 'Tečni biostimulator na bazi huminskih i fulvo kiselina za popravku zemljišta (20L)',
  },
  '632': {
    type: 'MINERALNO_GRANULISANO',
    unit: 'KG',
    description: 'Yara granulirani kalijum sulfat (SOP 50% K2O + 45% SO3) bez hlora za luk',
  },
  '484': {
    type: 'TECNI_BIOSTIMULATOR',
    unit: 'L',
    description: 'Koncentrovano tečno folijarno đubrivo sa manganom YaraVita (pakovanje 5L)',
  },
  '630': {
    type: 'VODOTOPIVO_FERTIRIGACIJA',
    unit: 'KG',
    description: 'Vodotopivo NPK kristalno đubrivo sa helatnim mikroelementima za sistem kpk (25kg)',
  },
};

async function main() {
  const isApply = process.argv.includes('--apply');
  console.log(`Otvaram Excel: ${EXCEL_PATH}`);
  const wb = xlsx.readFile(EXCEL_PATH);
  const ws = wb.Sheets['Min.djubrivo'];
  if (!ws) {
    console.error('Nije pronađen sheet "Min.djubrivo"!');
    process.exit(1);
  }

  const rawRows = xlsx.utils.sheet_to_json(ws, { header: 1 });
  const items = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || !row[0] || !row[1]) continue;

    const code = String(row[0]).trim();
    const name = String(row[1]).trim();
    const jm = String(row[2] || '').trim().toLowerCase();

    const detail = FERTILIZER_DETAILS[code] || {};
    let unit = detail.unit;
    if (!unit) {
      if (jm === 'lit' || jm === 'l') unit = 'L';
      else if (jm === 'tona' || jm === 't') unit = 'TONA';
      else if (jm === 'kom') unit = 'KOM';
      else unit = 'KG';
    }

    const type = detail.type || 'MINERALNO_GRANULISANO';
    const description = detail.description || null;

    items.push({
      code,
      name,
      type,
      unit,
      description,
      defaultLocation: 'Glavni magacin',
      minStockWarning: unit === 'L' ? 100 : 500,
    });
  }

  console.log(`Pronađeno ${items.length} artikala đubriva u sheetu "Min.djubrivo".`);
  items.forEach((it) => {
    console.log(` [${it.code}] ${it.name} (${it.type}, ${it.unit}) - ${it.description || '—'}`);
  });

  if (!isApply) {
    console.log('\nDRY RUN završena. Pokrenite sa --apply za upis u bazu.');
    process.exit(0);
  }

  console.log('\nUpisujem u bazu...');
  let createdCount = 0;
  let updatedCount = 0;

  for (const item of items) {
    // Proveri da li postoji po code ili name
    const existing = await prisma.fertilizerProduct.findFirst({
      where: {
        OR: [
          { code: item.code },
          { name: item.name },
        ],
      },
    });

    if (existing) {
      await prisma.fertilizerProduct.update({
        where: { id: existing.id },
        data: {
          code: item.code,
          name: item.name,
          type: item.type,
          unit: item.unit,
          description: item.description,
          isActive: true,
        },
      });
      updatedCount++;
    } else {
      await prisma.fertilizerProduct.create({
        data: {
          code: item.code,
          name: item.name,
          type: item.type,
          unit: item.unit,
          description: item.description,
          defaultLocation: item.defaultLocation,
          minStockWarning: item.minStockWarning,
          currentStock: 0,
          isActive: true,
        },
      });
      createdCount++;
    }
  }

  console.log(`\nUSPEŠNO: Kreirano ${createdCount}, Ažurirano ${updatedCount} artikala đubriva.`);
  const totalInDb = await prisma.fertilizerProduct.count({ where: { isActive: true } });
  console.log(`Ukupno aktivnih đubriva u bazi: ${totalInDb}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Greška pri uvozu đubriva:', err);
  process.exit(1);
});
