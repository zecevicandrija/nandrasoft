import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { prisma } from '../lib/prisma.js';
import { excludedWorkerNames, workerNames, workerEmail, parcels, machines } from './production-master-data.js';

const credentialsPath = new URL('../.private/production-worker-credentials.json', import.meta.url);
const apply = process.argv.includes('--apply');

try {
  const [database] = await prisma.$queryRaw`SELECT current_database() AS name`;
  assert.equal(database.name, 'nandraproduction', 'Import is restricted to nandraproduction');
  assert.equal(workerNames.length, 25);
  assert.equal(new Set(workerNames.map(workerEmail)).size, 25);
  assert.equal(parcels.length, 19);
  assert.equal(machines.length, 38);
  assert.ok(Math.abs(parcels.reduce((sum, p) => sum + p.areaHa, 0) - 645.3535) < 0.000001);

  if (apply) {
    let credentials;
    try { credentials = JSON.parse(await readFile(credentialsPath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      credentials = workerNames.map(name => ({ name, email: workerEmail(name), password: randomBytes(18).toString('base64url') }));
      await mkdir(new URL('../.private/', import.meta.url), { recursive: true });
      // Persist before the transaction so a successful import never loses the passwords.
      await writeFile(credentialsPath, JSON.stringify(credentials, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
    for (const name of workerNames) {
      assert.ok(credentials.some(c => c.name === name && c.email === workerEmail(name)), `Missing credentials: ${name}`);
    }
    const hashes = new Map();
    for (const c of credentials) hashes.set(c.email, await hashPassword(c.password));

    await prisma.$transaction(async tx => {
      for (const name of workerNames) {
        const email = workerEmail(name);
        const existing = await tx.user.findUnique({ where: { email }, include: { worker: true, accounts: true } });
        if (existing) {
          // Re-running verifies the imported identity; it never changes existing passwords.
          assert.equal(existing.name, name);
          assert.equal(existing.role, 'OPERATER');
          assert.equal(existing.worker?.role, 'OPERATER');
          assert.ok(existing.accounts.some(a => a.providerId === 'credential'));
          continue;
        }
        const userId = randomUUID();
        await tx.user.create({ data: {
          id: userId, name, email, role: 'OPERATER',
          accounts: { create: { accountId: userId, providerId: 'credential', password: hashes.get(email) } },
          worker: { create: { name, role: 'OPERATER', type: 'STALNI' } },
        } });
      }
      for (const parcel of parcels) {
        const existing = await tx.parcel.findUnique({ where: { code: parcel.code } });
        if (existing) {
          for (const key of ['name', 'areaHa', 'location']) assert.equal(existing[key], parcel[key]);
        } else await tx.parcel.create({ data: parcel });
      }
      for (const machine of machines) {
        const existing = await tx.machine.findUnique({ where: { id: machine.id } });
        if (existing) assert.equal(existing.name, machine.name);
        else await tx.machine.create({ data: machine });
      }
    }, { timeout: 30000 });
  }

  const users = await prisma.user.findMany({ include: { worker: true, accounts: true } });
  for (const name of workerNames) {
    const user = users.find(u => u.email === workerEmail(name));
    assert.ok(user, `Missing user: ${name}`);
    assert.equal(user.name, name);
    assert.equal(user.role, 'OPERATER');
    assert.equal(user.worker?.name, name);
    assert.equal(user.worker?.role, 'OPERATER');
    assert.equal(user.worker?.type, 'STALNI');
    assert.equal(user.isActive, true);
    assert.equal(user.worker?.isActive, true);
  }
  assert.equal(await prisma.user.count({ where: { name: { in: [...excludedWorkerNames, 'sezonci'] } } }), 0);
  assert.equal(await prisma.worker.count({ where: { name: { in: [...excludedWorkerNames, 'sezonci'] } } }), 0);
  const storedParcels = await prisma.parcel.findMany();
  for (const p of parcels) {
    const actual = storedParcels.find(row => row.code === p.code);
    assert.ok(actual);
    for (const key of ['name', 'areaHa', 'location']) assert.equal(actual[key], p[key]);
  }
  for (const m of machines) {
    const actual = await prisma.machine.findUnique({ where: { id: m.id } });
    assert.ok(actual);
    for (const key of ['name', 'type', 'regNumber', 'tankCapacityLiters']) assert.equal(actual[key], m[key]);
  }
  const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
  for (const c of credentials) {
    const account = users.find(u => u.email === c.email)?.accounts.find(a => a.providerId === 'credential');
    assert.ok(account && await verifyPassword({ hash: account.password, password: c.password }), `Invalid credential: ${c.email}`);
  }
  console.log(JSON.stringify({ database: database.name, users: users.length, workers: await prisma.worker.count(), parcels: storedParcels.length, areaHa: Number(storedParcels.reduce((sum, p) => sum + p.areaHa, 0).toFixed(4)), machines: await prisma.machine.count(), credentials: fileURLToPath(credentialsPath), verified: true }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
