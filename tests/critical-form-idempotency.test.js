import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { prisma } from '../lib/prisma.js';
import { auth } from '../routes/auth.js';
import onion from '../routes/onion.js';
import fertilizer from '../routes/fertilizer.js';
import tolls from '../routes/tolls.js';
import { mutationIdentity } from '../lib/mutationReceipt.js';

function request(router, path, body, key, headers) {
  return new Promise((resolve, reject) => router.handle({ method: 'POST', url: path, body, query: {},
    headers: headers || { 'x-idempotency-key': key },
  }, { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(body)) }); },
  }, error => reject(error || new Error('Unhandled request'))));
}

test('critical stock and ENP routes commit each keyed submission exactly once', async t => {
  const oldTransaction = prisma.$transaction, oldWorker = prisma.worker.findUnique;
  let state, failure = null, tail = Promise.resolve();
  let userId = 'manager';
  const reset = () => {
    failure = null; userId = 'manager';
    state = { receipts: [], shipments: [], movements: [], entries: [], topUps: [], audit: [], counters: {},
      lot: { id: 'lot', rawStockKg: 0, sortedQualityKg: 1000, sortedSmallKg: 0, packagedStockKg: 1000, shippedKg: 0 },
      packaging: { id: 'pack', lotId: 'lot', totalWeightKg: 1000, availableCount: 100, availableWeightKg: 1000, unitWeightKg: 10 },
      product: { id: 'product', name: 'Fertilizer', currentStock: 100, unit: 'KG', minStockWarning: 10, defaultPricePerUnit: 5 },
      machine: { id: 'machine', name: 'Truck', enpTagBalance: 1000, enpTagNumber: 'TAG' } };
  };
  const copy = value => structuredClone(value);
  const update = (target, data) => {
    for (const [key, value] of Object.entries(data)) target[key] = value && typeof value === 'object' && 'increment' in value ? target[key] + value.increment
      : value && typeof value === 'object' && 'decrement' in value ? target[key] - value.decrement : value;
    return copy(target);
  };
  const create = (rows, data) => { const row = { id: `row-${rows.length}`, ...data }; rows.push(copy(row)); return copy(row); };
  mock.method(auth.api, 'getSession', async () => ({ user: { id: userId, name: 'Manager', role: 'DIREKTOR', isActive: true }, session: {} }));
  mock.method(console, 'error', () => {});
  prisma.worker.findUnique = async () => ({ id: 'worker', name: 'Worker', isActive: true });
  prisma.$transaction = async callback => {
    const previous = tail; let unlock;
    tail = new Promise(resolve => { unlock = resolve; }); await previous;
    const before = copy(state);
    const tx = {
      async $queryRaw(strings, ...values) {
        if (strings.join('').includes('document_counter')) {
          const prefix = values[0]; state.counters[prefix] = (state.counters[prefix] || 0n) + 1n;
          return [{ lastValue: state.counters[prefix] }];
        }
        return copy(state.receipts.filter(row => row.userId === values[0] && row.key === values[1]));
      },
      async $executeRaw(strings, ...values) {
        if (strings.join('').includes('INSERT INTO "mutation_receipt"')) {
          if (failure === 'receipt') throw new Error('Receipt failure');
          const [userId, key, route, fingerprint, statusCode, response] = values;
          state.receipts.push({ userId, key, route, fingerprint, statusCode, response: JSON.parse(response) });
        }
        return 1;
      },
      onionPackaging: {
        async aggregate() { return copy({ _sum: { totalWeightKg: state.packaging.totalWeightKg, availableWeightKg: state.packaging.availableWeightKg } }); },
        async findUnique() { return copy({ ...state.packaging, lot: state.lot }); },
        async update({ data }) { return update(state.packaging, data); },
      },
      onionLot: { async update({ data }) { return update(state.lot, data); } },
      onionShipment: { async create({ data }) { return { ...create(state.shipments, data), buyer: { id: 'buyer', name: 'Buyer' } }; } },
      partner: { async findUnique() { return { id: 'buyer', name: 'Buyer' }; } },
      fertilizerProduct: { async findUnique() { return copy(state.product); }, async update({ data }) { return update(state.product, data); } },
      fertilizerMovement: { async create({ data }) { return create(state.movements, data); } },
      parcel: { async findUnique() { return { id: 'parcel', name: 'Parcel', areaHa: 10 }; } },
      worker: { async findUnique() { return { id: 'worker', name: 'Worker', isActive: true }; } },
      machine: { async findUnique() { return copy(state.machine); }, async update({ data }) { return update(state.machine, data); } },
      tollEntry: { async create({ data }) { return create(state.entries, data); } },
      tollTopUp: { async create({ data }) { return create(state.topUps, data); } },
      auditLog: { async create({ data }) { if (failure === 'audit') throw new Error('Audit failure'); return create(state.audit, data); } },
    };
    try { const result = await callback(tx); if (failure === 'commit') throw new Error('Commit failure'); return result; }
    catch(error) { state = before; throw error; } finally { unlock(); }
  };
  const scenarios = [
    { name: 'onion shipment', router: onion, path: '/shipment', body: { buyerId: 'buyer', packagingId: 'pack', packageCount: 2, date: '2026-10-31' },
      check() { assert.equal(state.shipments.length,1); assert.equal(state.packaging.availableCount,98); assert.equal(state.lot.packagedStockKg,980); assert.equal(Object.values(state.counters)[0],1n); } },
    { name: 'fertilizer issue', router: fertilizer, path: '/issue', body: { productId: 'product', quantity: 20, movementType: 'IZDAVANJE_NJIVA', parcelId: 'parcel', receivedWorkerId: 'worker' },
      check() { assert.equal(state.movements.length,1); assert.equal(state.product.currentStock,80); } },
    { name: 'toll payment', router: tolls, path: '/', body: { machineId: 'machine', workerId: 'worker', amount: 70, paymentMethod: 'ENP_TAG' },
      check() { assert.equal(state.entries.length,1); assert.equal(state.machine.enpTagBalance,930); } },
    { name: 'ENP top-up', router: tolls, path: '/top-up', body: { machineId: 'machine', amount: 100 },
      check() { assert.equal(state.topUps.length,1); assert.equal(state.machine.enpTagBalance,1100); } },
  ];
  try {
    for (const scenario of scenarios) {
      await t.test(`${scenario.name}: concurrent duplicates and a lost-response retry return one result`, async () => {
        reset(); const send = () => request(scenario.router, scenario.path, scenario.body, 'critical-request-123');
        const results = await Promise.all([send(),send(),send()]);
        assert.equal(results[0].status,201); assert.deepEqual(results[1],results[0]); assert.deepEqual(results[2],results[0]);
        assert.deepEqual(await send(),results[0]); scenario.check(); assert.equal(state.receipts.length,1); assert.equal(state.audit.length,1);
        const before = copy(state);
        const changed = await request(scenario.router, scenario.path, { ...scenario.body, notes: 'changed' }, 'critical-request-123');
        assert.equal(changed.status,409); assert.equal(changed.body.code,'IDEMPOTENCY_MISMATCH'); assert.deepEqual(state,before);
        const other = scenarios.find(s => s !== scenario);
        assert.equal((await request(other.router, other.path, other.body, 'critical-request-123')).status,409);
        assert.deepEqual(state,before);
      });
      for (const fail of ['audit','receipt','commit']) {
        await t.test(`${scenario.name}: ${fail} failure rolls back stock, document number and receipt`, async () => {
          reset(); failure = fail; const before = copy(state);
          const response = await request(scenario.router,scenario.path,scenario.body,'rollback-request-123');
          assert.ok(response.status >= 400); assert.deepEqual(state,before);
          failure = null;
          assert.equal((await request(scenario.router,scenario.path,scenario.body,'rollback-request-123')).status,201);
          scenario.check(); assert.equal(state.receipts.length,1); assert.equal(state.audit.length,1);
        });
      }
    }
    await t.test('a confirmed issue or dispatch replays even after its first execution exhausts stock', async () => {
      for (const scenario of scenarios.slice(0,2)) {
        reset();
        const body = scenario.name === 'onion shipment' ? { ...scenario.body, packageCount: 100 } : { ...scenario.body, quantity: 100 };
        const first = await request(scenario.router,scenario.path,body,'exhausted-request-123');
        assert.equal(first.status,201);
        assert.deepEqual(await request(scenario.router,scenario.path,body,'exhausted-request-123'),first);
        assert.equal(state.receipts.length,1); assert.equal(state.audit.length,1);
        if (scenario.name === 'onion shipment') { assert.equal(state.packaging.availableCount,0); assert.equal(state.shipments.length,1); }
        else { assert.equal(state.product.currentStock,0); assert.equal(state.movements.length,1); }
      }
    });
    await t.test('keys support both header spellings, remain user-scoped and reject conflicting headers', async () => {
      reset(); const s = scenarios[3], key = 'headers-request-123';
      const first = await request(s.router,s.path,s.body,key);
      assert.deepEqual(await request(s.router,s.path,s.body,key,{ 'idempotency-key': key }),first);
      assert.deepEqual(await request(s.router,s.path,s.body,key,{ 'idempotency-key': key, 'x-idempotency-key': key }),first);
      assert.equal((await request(s.router,s.path,s.body,key,{ 'idempotency-key': key, 'x-idempotency-key': 'different-key-123' })).status,400);
      assert.equal((await request(s.router,s.path,s.body,'bad')).status,400);
      assert.equal(state.topUps.length,1);
      userId = 'other-manager'; assert.equal((await request(s.router,s.path,s.body,key)).status,201);
      assert.equal(state.topUps.length,2); assert.equal(state.machine.enpTagBalance,1200);
      assert.ok(mutationIdentity({ method:'POST',url:'/',user:{id:'u'},headers:{'x-idempotency-key':key},body:{} }));
    });
  } finally { prisma.$transaction = oldTransaction; prisma.worker.findUnique = oldWorker; mock.restoreAll(); }
});

test.after(async () => { await prisma.$disconnect(); });
