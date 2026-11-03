import 'dotenv/config';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma.js';
import { addMoney, multiplyMoney, money } from '../lib/money.js';

// Read the supplied price list without modifying it or running the demo seed.
const source = new URL('../../CENOVNIK USLUGA2023-2024-polj.v.xlsx', import.meta.url);
const categoryByRow = {
  18: 'ZASTITA', 19: 'OBRADA', 20: 'OBRADA', 21: 'OBRADA', 22: 'OBRADA',
  23: 'OBRADA', 24: 'OBRADA', 25: 'OBRADA', 26: 'SETVA', 27: 'SETVA',
  28: 'SETVA', 29: 'OBRADA', 30: 'ZASTITA', 31: 'ZASTITA',
  32: 'ZETVA_BERBA', 33: 'ZETVA_BERBA', 34: 'ZETVA_BERBA',
};

try {
  const [database] = await prisma.$queryRaw`SELECT current_database() AS name`;
  assert.equal(database.name, 'nandraproduction', 'Import is restricted to nandraproduction');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(fileURLToPath(source));
  const sheet = workbook.getWorksheet('Sheet1');
  const referenceFuelPrice = Number(sheet.getCell('D15').value);
  assert.equal(referenceFuelPrice, 171.66);
  const services = [];
  for (let row = 18; row <= 34; row++) {
    const name = String(sheet.getCell(`B${row}`).value).trim();
    const expression = String(sheet.getCell(`C${row}`).value).trim();
    const match = expression.match(/^(\d+)\s*lit\s*\+\s*([\d.]+)\s*din/i);
    assert.ok(match, `Cannot parse price at row ${row}: ${expression}`);
    const fuelNormLitersPerHa = Number(match[1]);
    const laborPricePerHa = Number(match[2].replaceAll('.', ''));
    const totalPricePerHa = addMoney(laborPricePerHa, multiplyMoney(fuelNormLitersPerHa, referenceFuelPrice));
    assert.equal(totalPricePerHa, money(sheet.getCell(`D${row}`).result), `Source total mismatch at row ${row}`);
    services.push({ name, category: categoryByRow[row], unit: 'ha', fuelNormLitersPerHa,
      laborPricePerHa, totalPricePerHa, referenceFuelPrice, isActive: true });
  }
  assert.equal(services.length, 17);
  assert.equal(new Set(services.map(s => s.name)).size, 17);
  if (process.argv.includes('--apply')) {
    await prisma.$transaction(services.map(service => prisma.workType.upsert({
      where: { name: service.name }, create: service, update: service,
    })));
  }
  const stored = await prisma.workType.findMany({ where: { name: { in: services.map(s => s.name) } } });
  assert.equal(stored.length, services.length);
  for (const service of services) {
    const actual = stored.find(s => s.name === service.name);
    for (const [key, value] of Object.entries(service)) assert.equal(actual[key], value, `${service.name}: ${key}`);
  }
  console.log(JSON.stringify({ database: database.name, verifiedServices: stored.length,
    referenceFuelPrice, pricesExcludeVat: true, totalServices: await prisma.workType.count() }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
