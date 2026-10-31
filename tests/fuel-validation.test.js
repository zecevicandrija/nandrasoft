import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { prisma } from '../lib/prisma.js';
const restore = [];
const patch = (obj, key, value) => { const old = obj[key]; obj[key] = value; restore.push(() => { obj[key] = old; }); };
import { auth } from '../routes/auth.js';
import router from '../routes/fuel.js';

function request(method, body) {
  return new Promise((resolve, reject) => router.handle({ method, url: method === 'POST' ? '/entries' : '/entries/entry', body, headers: {}, query: {} }, {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  }, error => reject(error || new Error('Unhandled request'))));
}

test('fuel entries validate links on POST and PUT without premature consumption alarms', async t => {
  let role = 'DIREKTOR', work = null, written = [];
  const machine = { id: 'machine', name: 'Tractor', type: 'TRAKTOR', tankCapacityLiters: 250, currentFuelLiters: 0 };
  const worker = { id: 'worker', isActive: true };
  const existing = { id: 'entry', date: new Date(), machineId: machine.id, machine, workerId: worker.id, worker,
    liters: 40, fuelSource: 'PUMPA', gasStation: 'PETROL', totalCost: 8000, pricePerLiter: 200 };
  const tx = {
    async $executeRaw() {},
    machine: { async findUnique() { return machine; }, async update() {} },
    worker: { async findUnique() { return worker; } },
    fieldWork: { async findUnique() { return work; }, async findFirst() { throw new Error('Must not guess a field work'); } },
    fuelEntry: {
      async findUnique() { return existing; },
      async create({ data }) { written.push(data); return { id: 'entry', ...data }; },
      async update({ data }) { written.push(data); return { ...existing, ...data }; },
    },
    auditLog: { async create() {} },
  };
  mock.method(auth.api, 'getSession', async () => ({ user: { id: 'user', role, isActive: true }, session: {} }));
  patch(prisma.worker, 'findUnique', async () => worker);
  patch(prisma, '$transaction', async fn => fn(tx));
  const payload = { machineId: machine.id, workerId: worker.id, fuelSource: 'PUMPA', gasStation: 'PETROL', liters: 40, totalCost: 8000 };
  try {
    await t.test('morning refill above 35 L succeeds with no field work and no alarm', async () => {
      const r = await request('POST', payload);
      assert.equal(r.status, 201); assert.equal(r.body.hasAnomaly, false);
      assert.equal(written.at(-1).fieldWorkId, null);
    });
    for (const method of ['POST', 'PUT']) {
      await t.test(`${method} rejects missing or foreign machine work`, async () => {
        for (const value of [null, { machineId: 'other' }]) {
          work = value; const before = written.length;
          assert.equal((await request(method, { ...payload, fieldWorkId: 'work' })).status, 400);
          assert.equal(written.length, before);
        }
      });
      await t.test(`${method} worker must match owner and day`, async () => {
        role = 'OPERATER';
        for (const value of [
          { machineId: machine.id, workerId: 'other', date: existing.date },
          { machineId: machine.id, workerId: worker.id, date: '2020-01-01' },
        ]) {
          work = value;
          assert.equal((await request(method, { ...payload, fieldWorkId: 'work' })).status, 400);
        }
        work = { machineId: machine.id, workerId: worker.id, date: existing.date };
        assert.equal((await request(method, { ...payload, fieldWorkId: 'work' })).status, method === 'POST' ? 201 : 200);
        role = 'DIREKTOR';
      });
      await t.test(`${method} rejects physical capacity excess`, async () => {
        assert.equal((await request(method, { ...payload, liters: 251 })).status, 400);
        machine.currentFuelLiters = 240;
        assert.equal((await request(method, { ...payload, liters: 60 })).status, 400);
        machine.currentFuelLiters = 0;
      });
    }
    await t.test('worker still needs a receipt or price', async () => {
      role = 'OPERATER';
      assert.equal((await request('POST', { ...payload, totalCost: undefined })).status, 400);
    });
  } finally { mock.restoreAll(); restore.splice(0).reverse().forEach(fn => fn()); }
});

test.after(async () => { await prisma.$disconnect(); });
