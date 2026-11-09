import 'dotenv/config';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { prisma } from '../lib/prisma.js';

// Read seeds from 'Seme, djubrivo, hemija.XLS'
const xlsPath = fileURLToPath(new URL('../../Seme, djubrivo, hemija.XLS', import.meta.url));

// Extract rows using python xlrd
const pythonScript = `
import xlrd, json

book = xlrd.open_workbook(r'''${xlsPath}''')
sheet = book.sheet_by_name('Semena')

crops_map = [
    ('SEME KUKURUZA', 'Kukuruz'),
    ('SEME LUKA', 'Luk'),
    ('SEME PSENICE', 'Pšenica'),
    ('SEME SECERNE REPE', 'Šećerna repa'),
    ('SEME SOJE', 'Soja'),
    ('SEME SUNCOKRETA', 'Suncokret'),
]

unit_map = {
    'kom': 'KOM',
    'KOM': 'KOM',
    'SJ': 'SJ',
    'kg': 'KG',
    'KG': 'KG'
}

def get_details(name, crop, rest):
    mfg = None
    variety = rest
    notes = None
    
    if '+ACC ELITE' in rest:
        notes = 'Tretman: Acceleron Elite'
    elif '+ACCELERON' in rest:
        notes = 'Tretman: Acceleron'
    elif '+FORCE' in rest:
        notes = 'Tretman: Force'
    elif 'B-MOX' in rest:
        notes = 'B-Mox tehnologija poboljšanja semena'
    elif 'RESSIVI+PLENARIS' in rest or 'RESSIVI+PLEN.' in rest:
        notes = 'Tretman: Ressivi + Plenaris'
    elif 'N-MAX' in rest:
        notes = 'Inokulant N-Max'

    if 'DEKALB' in rest or 'DKC' in rest:
        mfg = 'Bayer Dekalb'
    elif 'SFS' in rest:
        mfg = 'Strube'
    elif 'RWA' in rest:
        mfg = 'RWA'
    elif any(b in rest for b in ['CROCKETT', 'ELEMENT', 'LEGEND', 'CITRATION', 'HAMILTON']):
        mfg = 'Bejo Zaden'
    elif 'SONOMA' in rest:
        mfg = 'Nunhems (BASF)'
    elif 'KWS' in rest or rest in ['NEBRASKA 150', 'THEOS 150']:
        mfg = 'KWS'
    elif 'OVALIE CS' in rest:
        mfg = 'Caussade Semences (Lidea)'
    elif crop == 'Šećerna repa':
        mfg = 'SESVanderHave'
    elif 'ES COMANDOR' in rest or 'ES GENESIS' in rest or rest == 'LID':
        mfg = 'Lidea'
    elif 'SYNG' in rest or 'BLADE' in rest or 'KONDI' in rest:
        mfg = 'Syngenta'
    elif rest == 'LG':
        mfg = 'Limagrain'
    elif 'MAS' in rest:
        mfg = 'MAS Seeds'
    elif 'P64 LE99' in rest or 'PIONEER' in rest:
        mfg = 'Pioneer (Corteva)'
        
    return variety, mfg, notes

items = []
for r in range(2, sheet.nrows):
    sifar = sheet.cell_value(r, 0)
    code = str(int(sifar)) if isinstance(sifar, float) and sifar.is_integer() else str(sifar).strip()
    name = str(sheet.cell_value(r, 1)).strip()
    raw_jm = str(sheet.cell_value(r, 2)).strip()
    unit = unit_map.get(raw_jm, raw_jm.upper())
    
    crop = 'Ostalo'
    rest = name
    for prefix, c in crops_map:
        if name.upper().startswith(prefix):
            crop = c
            rest = name[len(prefix):].strip()
            break
            
    variety, mfg, notes = get_details(name, crop, rest)
    items.append({
        'code': code,
        'name': name,
        'crop': crop,
        'variety': variety,
        'manufacturer': mfg,
        'unit': unit,
        'notes': notes,
        'isActive': True
    })

print(json.dumps(items, ensure_ascii=False))
`;

try {
  const output = execFileSync('python', ['-c', pythonScript], { encoding: 'utf8' });
  const seeds = JSON.parse(output);

  assert.equal(seeds.length, 44, 'Mora postojati tačno 44 semena u tabeli');
  assert.equal(new Set(seeds.map(s => s.code)).size, 44, 'Sve šifre semena moraju biti unikatne');

  const apply = process.argv.includes('--apply');
  console.log(`Pronađeno ${seeds.length} semena u Excel fajlu.`);

  if (apply) {
    console.log('Ubacivanje / ažuriranje semena u bazi...');
    for (const seed of seeds) {
      await prisma.seedProduct.upsert({
        where: { code: seed.code },
        create: seed,
        update: seed,
      });
    }
    console.log('Uspešno sačuvano svih 44 semena.');
  } else {
    console.log('DRY RUN: Pokrenite sa --apply za upis u bazu.');
  }

  const storedSeeds = await prisma.seedProduct.findMany({
    where: { code: { in: seeds.map(s => s.code) } },
    orderBy: { code: 'asc' },
  });

  if (apply) {
    assert.equal(storedSeeds.length, 44, 'U bazi mora biti 44 semena');
    for (const seed of seeds) {
      const stored = storedSeeds.find(s => s.code === seed.code);
      assert.ok(stored, `Seme sa šifrom ${seed.code} nedostaje u bazi`);
      assert.equal(stored.name, seed.name);
      assert.equal(stored.crop, seed.crop);
      assert.equal(stored.unit, seed.unit);
    }
    console.log('Verifikacija uspešna: Svih 44 semena je verifikovano u bazi.');
  }
} catch (error) {
  console.error('Greška pri uvozu semena:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

