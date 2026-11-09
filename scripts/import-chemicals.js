import 'dotenv/config';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { prisma } from '../lib/prisma.js';

// Read chemicals from 'Seme, djubrivo, hemija.XLS'
const xlsPath = fileURLToPath(new URL('../../Seme, djubrivo, hemija.XLS', import.meta.url));

// Extract rows using python xlrd
const pythonScript = `
import xlrd, json

book = xlrd.open_workbook(r'''${xlsPath}''')
sheet = book.sheet_by_name('Hemija')

# Non-chemical / non-spray ledger rows (harvested crops, byproducts, construction, crates, drip tape, manure)
excluded_codes = {'423', '506', '505', '742', '490', '223', '282', '3', '41', '4', '60', '32', '45', '108', '53', '701', '43', '39'}

active_ingredients = {
    'ADENGO': 'Izoksaflutol + tienkarbazon-metil + ciprosulfamid',
    'AFFINITY PLUS': 'Karfentrazon-etil + mekoprop-P',
    'AFINEX': 'Acetamiprid',
    'AMISTAR PLUS': 'Azoksistrobin + difenokonazol',
    'AMPLIGO': 'Hlorantraniliprol + lambda-cihalotrin',
    'APUS': 'Nikosulfuron',
    'BASAR': 'S-metolahlor',
    'BENTAMARK': 'Bentazon',
    'BETANAL TANDEM': 'Fenmedifam + etofumesat',
    'BIATHLON': 'Tritosulfuron + florasulam',
    'BONACA': 'Fluroksipir',
    'CEREALIS': 'Tifensulfuron-metil',
    'COPPERFIT': 'Bakar-oksihlorid',
    'COPPERRFIT': 'Bakar-oksihlorid',
    'CORMAX': 'Mezotrion + nikosulfuron + rimsulfuron',
    'CORUM': 'Bentazon + imazamoks',
    'CYTHRIN': 'Cipermetrin',
    'DELARO': 'Protiokonazol + trifloksistrobin',
    'DELMAX': 'Deltametrin',
    'DESPOT': 'Hlorpirifos + cipermetrin',
    'DICARZOL': 'Formetanat-hidrohlorid',
    'EPHON TOP': 'Etefon',
    'EXIREL': 'Cijantraniliprol',
    'EXPRESS': 'Tribenuron-metil',
    'FALCON FORTE': 'Spiroksamin + tebukonazol + protiokonazol',
    'FIESTA': 'Kaptan',
    'FLOYD': 'Fluroksipir',
    'FORCE': 'Teflutrin',
    'FRONTIER SUPER': 'Dimetenamid-P',
    'FUNGURAN': 'Bakar-hidroksid',
    'FUSILADE FORTE': 'Fluazifop-P-butil',
    'GALOFUNGIN': 'Tiofanat-metil',
    'GLIFOHEM': 'Glifosat',
    'GLIFOL': 'Glifosat',
    'GLIFOMARK': 'Glifosat',
    'GLIFOSAV': 'Glifosat',
    'GLIFOTOP': 'Glifosat',
    'GLOBUS': 'Kvizalofop-P-etil',
    'GOLTIX GOLD': 'Metamitron',
    'GROM': 'Deltametrin',
    'HEMOMITRON': 'Metamitron',
    'IMOX': 'Imazamoks',
    'INFINITO': 'Propamokarb-hidrohlorid + fluopikolid',
    'ITCAN': 'Maleinski hidrazid',
    'KARIKA': 'Kletodim',
    'KLETOX EXTRA': 'Kletodim',
    'KOMERSANT': 'Tifensulfuron-metil',
    'KONA': 'Klopiralid',
    'LARISSA': 'Imazamoks',
    'LAUDIS': 'Tembotrion',
    'LENTAGRAN': 'Piridat',
    'LODIN': 'Fluroksipir',
    'LUNA EXPIRIANCE': 'Fluopiram + tebukonazol',
    'METAK': 'Metamitron',
    'MEZATRON': 'Mezotrion',
    'MIURA': 'Kvizalofop-P-etil',
    'MONT': 'S-metolahlor',
    'MOTIVELL': 'Nikosulfuron',
    'MOVENTO': 'Spirotetramat',
    'NIKOSAV': 'Nikosulfuron',
    'NORDOX': 'Bakar(I)-oksid',
    'NUMA': 'Mezotrion',
    'NURELLE D': 'Hlorpirifos + cipermetrin',
    'OLIMP DUO': 'Imazamoks + bentazon',
    'OLIMP': 'Imazamoks',
    'ORONDIS ULTRA': 'Oksatiapiprolin + mandipropamid',
    'ORVEGO': 'Ametoktradin + dimetomorf',
    'PENDISTOP': 'Pendimetalin',
    'PIRALIS': 'Klopiralid',
    'PLAMEN': 'Dikamba',
    'POLUX': 'Deltametrin',
    'PRIAXOR': 'Fluksapiroksad + piraklostrobin',
    'PRINCIPAL FLEX': 'Nikosulfuron + rimsulfuron + dikamba',
    'PROPULSE': 'Fluopiram + protiokonazol',
    'PROSARO': 'Protiokonazol + tebukonazol',
    'PULSAR PLUS': 'Imazamoks',
    'PYLON': 'Pirimifos-metil',
    'QUELEX': 'Halauksifen-metil (Arylex) + florasulam',
    'QUENN': 'Kvisalofop-P-tefuril',
    'RACER': 'Fluorohloridon',
    'RAMPA': 'Klomazon',
    'REGLON FORTE': 'Dikvat-dibromid',
    'REVYVIT': 'Mefentriflukonazol',
    'REZON': 'Terbutilazin',
    'RIDOMIL GOLD R': 'Mefenoksam + bakar-oksihlorid',
    'RIDOWN': 'Glifosat',
    'RIMEX': 'Rimsulfuron',
    'RINICO': 'Rimsulfuron + nikosulfuron',
    'RINPODE': 'Indoksakarb',
    'ROMAZ': 'Imazamoks',
    'ROYAL MH': 'Maleinski hidrazid',
    'SERCADIS': 'Fluksapiroksad',
    'SIGNUM': 'Boskalid + piraklostrobin',
    'SIGURA': 'Tifensulfuron-metil',
    'SIRAKCID': 'Kletodim',
    'SIRIUS': 'Piridat',
    'SISTEMIN GOLD': 'Dimetoat',
    'SKAUT': 'Kvisalofop-P-etil',
    'SOILGUARD': 'Teflutrin',
    'SPYRALE': 'Difenokonazol + fenpropidin',
    'STOMP AQUA': 'Pendimetalin',
    'SWITCH': 'Ciprodinil + fludioksonil',
    'TARAS': 'Terbutilazin',
    'TERBIS': 'Terbutilazin',
    'TERN': 'Fenpropidin',
    'THIOVET JET': 'Sumpor',
    'TRIMARK': 'Tribenuron-metil',
    'UGO': 'Haloksifop-P-metil',
    'UNIFY': 'Piraklostrobin + fluksapiroksad',
    'UNIVOQ': 'Fenpikoksamid (Inatreq) + protiokonazol',
    'VIBALLA': 'Halauksifen-metil (Arylex)',
    'VILOTRIN': 'Lambda-cihalotrin',
    'ZORVEC ENTECTA': 'Oksatiapiprolin + amisulbrom',
}

adjuvants_and_foliar = {
    'ACTISTART': ('Biostimulator / starter', 'Folijarna prihrana sa biostimulativnim delovanjem'),
    'ANNEX': ('Adjuvant / okvašivač', 'Poboljšava kvašenje i usvajanje preparata'),
    'ANOVIT': ('Folijarno đubrivo sa aminokiselinama', 'Biostimulator za ublažavanje stresa'),
    'AZOTOMIC': ('Mikrobiološko đubrivo', 'Bakterijski inokulant za fiksaciju azota'),
    'BIOEHO': ('Biostimulator', 'Mikrobiološki stimulator rasta'),
    'BIOFOR ACTIVE': ('Mikrobiološko đubrivo', 'Zemljišni i folijarni biostimulator'),
    'BOMBARDIER': ('Biostimulator organskog porekla', 'Biljne aminokiseline i polisaharidi'),
    'BORAMIDE': ('Folijarno đubrivo sa borom', 'Bor za poboljšanje cvetanja i oplodnje'),
    'CITAS': ('Okvašivač / lepak', 'Poboljšava distribuciju depozita na listu'),
    'DASH': ('Adjuvant / okvašivač', 'Specijalni okvašivač za herbicide (BASF)'),
    'EPIN EKSTRA': ('Bioregulator / fitohormon', 'Epibrasinolid - antistres preparat'),
    'FLEX': ('Okvašivač / adjuvant', 'Sredstvo za smanjenje površinskog napona kapi'),
    'PROTIFERT': ('Organsko folijarno đubrivo', 'Aminokiseline i azot'),
    'RW STICK AF': ('Okvašivač / lepak', 'Adjuvant za smanjenje spiranja kišom'),
    'SPEED FOR CORN': ('Folijarni biostimulator', 'Specijalno formulisan za kukuruz'),
    'STIMSTART': ('Biostimulator', 'Aktivator početnog rasta i ukorenjavanja'),
    'SURFARE': ('Okvašivač / nejonski surfaktant', 'Poboljšava penetraciju pesticida'),
    'TREND 90': ('Okvašivač (isodecil alkohol etoksilat)', 'Za primenu sa sulfonilurea herbicidima'),
    'VIENER ZN': ('Folijarno đubrivo sa cinkom', 'Formulisani cink za kukuruz i luk'),
    'VIN FILM': ('Okvašivač / lepak na bazi pinolina', 'Sprečava spiranje kišom'),
    'VITAGREEN': ('Biostimulator / ekstrakt algi', 'Ekstrakt morskih algi za imunitet biljaka'),
    'VIVOLT 90': ('Okvašivač / lepak', 'Poboljšava usvajanje herbicida'),
    'XINCA': ('Folijarno đubrivo sa cinkom', 'Helatizirani cink visoke koncentracije'),
}

unit_map = {
    'LIT': 'L',
    'L': 'L',
    'kg': 'KG',
    'kom': 'KOM',
}

items = []
for r in range(1, sheet.nrows):
    sifar = sheet.cell_value(r, 0)
    code = str(int(sifar)) if isinstance(sifar, float) and sifar.is_integer() else str(sifar).strip()
    name = str(sheet.cell_value(r, 1)).strip()
    raw_jm = str(sheet.cell_value(r, 2)).strip()

    if code in excluded_codes:
        continue

    unit = unit_map.get(raw_jm, 'L')
    active_ingredient = None
    notes = None

    for k, v in active_ingredients.items():
        if k in name.upper():
            active_ingredient = v
            break

    if not active_ingredient:
        for k, (ing, note) in adjuvants_and_foliar.items():
            if k in name.upper():
                active_ingredient = ing
                notes = note
                break

    items.append({
        'code': code,
        'name': name,
        'activeIngredient': active_ingredient,
        'unit': unit,
        'notes': notes,
        'isActive': True
    })

print(json.dumps(items, ensure_ascii=False))
`;

try {
  const output = execFileSync('python', ['-c', pythonScript], { encoding: 'utf8' });
  const chemicals = JSON.parse(output);

  assert.equal(chemicals.length, 168, 'Mora postojati tačno 168 preparata za prskanje');
  assert.equal(new Set(chemicals.map(c => c.code)).size, 168, 'Sve šifre preparata moraju biti unikatne');

  const apply = process.argv.includes('--apply');
  console.log(`Pronađeno ${chemicals.length} preparata za prskanje u tabeli.`);

  if (apply) {
    console.log('Ubacivanje / ažuriranje preparata za prskanje u bazi...');
    for (const chem of chemicals) {
      await prisma.chemicalProduct.upsert({
        where: { code: chem.code },
        create: chem,
        update: chem,
      });
    }
    console.log('Uspešno sačuvano svih 168 preparata za prskanje.');
  } else {
    console.log('DRY RUN: Pokrenite sa --apply za upis u bazu.');
  }

  const stored = await prisma.chemicalProduct.findMany({
    where: { code: { in: chemicals.map(c => c.code) } },
    orderBy: { code: 'asc' },
  });

  if (apply) {
    assert.equal(stored.length, 168, 'U bazi mora biti sačuvano 168 preparata');
    for (const chem of chemicals) {
      const actual = stored.find(c => c.code === chem.code);
      assert.ok(actual, `Preparat sa šifrom ${chem.code} nedostaje u bazi`);
      assert.equal(actual.name, chem.name);
      assert.equal(actual.unit, chem.unit);
      assert.equal(actual.activeIngredient, chem.activeIngredient);
    }
    console.log('Verifikacija uspešna: Svih 168 preparata je verifikovano u bazi.');
  }
} catch (error) {
  console.error('Greška pri uvozu preparata za prskanje:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

