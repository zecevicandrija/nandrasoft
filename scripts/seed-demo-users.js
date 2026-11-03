import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { auth } from '../routes/auth.js';

// Matches the demo login buttons in frontend/src/PocetniEkran.tsx.
const demoUsers = [
  { name: 'Demo Direktor', email: 'direktor@nandra.rs', role: 'DIREKTOR' },
  { name: 'Demo Rukovodilac', email: 'rukovodilac@nandra.rs', role: 'RUKOVODILAC' },
  { name: 'Demo Magacin', email: 'magacin@nandra.rs', role: 'MAGACIN' },
  { name: 'Demo Mehaničar', email: 'mehanicar@nandra.rs', role: 'MEHANICAR' },
  { name: 'Demo Operater', email: 'operater@nandra.rs', role: 'OPERATER' },
];

try {
  const [database] = await prisma.$queryRaw`SELECT current_database() AS name`;
  assert.equal(database.name, 'nandraproduction', 'Demo seed is restricted to the requested demo database');
  const ctx = await auth.$context;
  const password = await ctx.password.hash('nandra123');

  await prisma.$transaction(async tx => {
    for (const demo of demoUsers) {
      const user = await tx.user.upsert({
        where: { email: demo.email },
        create: { id: randomUUID(), ...demo },
        update: { role: demo.role, isActive: true },
      });
      const accounts = await tx.account.findMany({ where: { userId: user.id, providerId: 'credential' } });
      assert.ok(accounts.length <= 1, `Duplicate credential accounts: ${demo.email}`);
      if (accounts.length) {
        await tx.account.update({ where: { id: accounts[0].id }, data: { password } });
      } else {
        await tx.account.create({ data: {
          id: randomUUID(), userId: user.id, accountId: user.id, providerId: 'credential', password,
        } });
      }
      await tx.worker.upsert({
        where: { userId: user.id },
        create: { name: user.name, role: demo.role, type: 'STALNI', userId: user.id },
        update: { role: demo.role, isActive: true },
      });
    }
  });

  // Exercise the actual login flow and remove only the sessions created by this check.
  for (const demo of demoUsers) {
    const result = await auth.api.signInEmail({ body: { email: demo.email, password: 'nandra123' } });
    try {
      assert.ok(result.token, `Login failed: ${demo.email}`);
      assert.equal(result.user.role, demo.role);
      console.log(`Login verified: ${demo.email} (${demo.role})`);
    } finally {
      if (result.token) await prisma.session.deleteMany({ where: { token: result.token } });
    }
  }
  console.log(`Demo accounts ready in ${database.name}. Total users: ${await prisma.user.count()}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
