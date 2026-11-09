import 'dotenv/config';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { prisma } from '../lib/prisma.js';

// Read 'Seme, djubrivo, hemija.XLS' sheet 'Ulja i gorivo'
const xlsPath = fileURLToPath(new URL('../../Seme, djubrivo, hemija.XLS', import.meta.url));

const pythonScript = `
import xlrd, json

book = xlrd.open_workbook(r'''${xlsPath}''')
sheet = book.sheet_by_name('Ulja i gorivo')

category_map = {
    '123': ('GORIVO', 'L', 'Osnovno pogonsko gorivo za traktore, kombajne i radne mašine'),
    '122': ('GORIVO', 'L', 'Zimski aditivirani evrodizel za niske temperature i osetljivije motore'),
    '5': ('HIDRAULICNO_ULJE', 'L', 'Hidraulično ulje za hidrauliku traktora, podrivača, utovarivača i kipere'),
    '61': ('MOTORNO_ULJE', 'L', 'Polusintetičko motorno ulje za novije traktore (John Deere, Claas)'),
    '126': ('MOTORNO_ULJE', 'L', 'Mineralno motorno ulje za standardne radne mašine i teške uslove rada'),
    '573': ('TRANSMISIONO_ULJE', 'KOM', 'Transmisiono-hidraulično UTTO ulje sa aditivima za mokre kočnice traktora'),
    '124': ('PUTARINA', 'KOM', 'Operativni putni trošak transporta / ENP tag dopuna za kamione')
}

items = []
for r in range(sheet.nrows):
    row = sheet.row_values(r)
    sifar = row[0]
    if isinstance(sifar, float) and sifar.is_integer():
        code = str(int(sifar))
    elif str(sifar).strip().isdigit():
        code = str(sifar).strip()
    else:
        continue

    name = str(row[1]).strip()
    raw_jm = str(row[2]).strip()
    cat_info = category_map.get(code, ('OSTALO', 'L', ''))

    items.append({
        'code': code,
        'name': name,
        'category': cat_info[0],
        'unit': cat_info[1],
        'notes': cat_info[2],
        'isActive': True
    })

print(json.dumps(items, ensure_ascii=False))
`;

try {
  const output = execFileSync('python', ['-c', pythonScript], { encoding: 'utf8' });
  const items = JSON.parse(output);

  assert.equal(items.length, 7, 'Mora postojati tačno 7 artikala ulja i goriva u tabeli');
  assert.equal(new Set(items.map(i => i.code)).size, 7, 'Sve šifre moraju biti unikatne');

  const apply = process.argv.includes('--apply');
  console.log(`Pronađeno ${items.length} artikala ulja i goriva u tabeli.`);

  if (apply) {
    console.log('Ubacivanje / ažuriranje artikala u tabeli oil_fuel_product...');
    for (const item of items) {
      await prisma.oilFuelProduct.upsert({
        where: { code: item.code },
        create: item,
        update: item,
      });
    }
    console.log('Uspešno sačuvano svih 7 artikala ulja i goriva.');
  } else {
    console.log('DRY RUN: Pokrenite sa --apply za upis u bazu.');
  }

  const stored = await prisma.oilFuelProduct.findMany({
    where: { code: { in: items.map(i => i.code) } },
    orderBy: { code: 'asc' },
  });

  if (apply) {
    assert.equal(stored.length, 7, 'U bazi mora biti 7 artikala ulja i goriva');
    for (const item of items) {
      const actual = stored.find(s => s.code === item.code);
      assert.ok(actual, `Artikal sa šifrom ${item.code} nedostaje u bazi`);
      assert.equal(actual.name, item.name);
      assert.equal(actual.category, item.category);
      assert.equal(actual.unit, item.unit);
    }
    console.log('Verifikacija uspešna: Svih 7 artikala je verifikovano u bazi.');
  }
} catch (error) {
  console.error('Greška pri uvozu ulja i goriva:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

