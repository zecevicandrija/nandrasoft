import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendDurably, submissionKey, type SubmissionStorage, type PendingSubmission } from '../src/lib/durableSubmission.ts';

const memory = (): SubmissionStorage => {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
};
const cases = [
  ['onion-shipment', '/api/onion/shipment', { packagingId: 'pack', buyerId: 'buyer', packageCount: 10, date: '2026-11-01' }],
  ['fertilizer-issue', '/api/fertilizer/issue', { productId: 'product', quantity: 250, movementType: 'IZDAVANJE_NJIVA', parcelId: 'parcel', receivedWorkerId: 'worker' }],
  ['toll-entry', '/api/tolls', { machineId: 'truck', amount: 1200, paymentMethod: 'ENP_TAG' }],
  ['toll-top-up', '/api/tolls/top-up', { machineId: 'truck', amount: 5000, paymentReference: 'REF-1' }],
] as const;

for (const [scope, url, payload] of cases) {
  test(`${scope}: double submit, connection loss and reload preserve one key and original request`, async () => {
    const storage = memory(), key = submissionKey('manager', scope);
    const sent: RequestInit[] = [];
    const offline: typeof fetch = async (_url, options) => { sent.push(options!); throw new TypeError('Connection lost after commit'); };
    await Promise.allSettled([sendDurably(storage,key,url,payload,offline),sendDurably(storage,key,url,payload,offline)]);
    assert.equal(sent.length,2); assert.deepEqual(sent[0],sent[1]);
    const pending = JSON.parse(storage.getItem(key)!) as PendingSubmission;
    const headers = sent[0].headers as Record<string, string>;
    assert.equal(headers['X-Idempotency-Key'],pending.key); assert.equal(headers['Idempotency-Key'],pending.key);
    assert.deepEqual(pending.payload,payload);
    const result = await sendDurably(storage,key,pending.url,pending.payload,async (_url,options) => {
      assert.equal(options?.body,sent[0].body); assert.deepEqual(options?.headers,sent[0].headers);
      return Response.json({ id:'one-operation' }, { status:201 });
    });
    assert.equal(result.id,'one-operation');
    assert.ok(storage.getItem(key),'request stays durable until the form acknowledges success');
    storage.removeItem(key);
    await sendDurably(storage,key,url,payload,async (_url,options) => {
      assert.notEqual((options?.headers as Record<string,string>)['X-Idempotency-Key'],pending.key);
      return Response.json({ id:'intentional-next-operation' }, { status:201 });
    });
  });
}

test('temporary inventory lock conflict keeps the key because another copy may still commit', async () => {
  const storage = memory();
  await assert.rejects(sendDurably(storage,'form','/api/tolls/top-up',{ amount:100 },async () =>
    Response.json({ code:'INVENTORY_BUSY',error:'Try again' },{ status:409 })), /Try again/);
  const pending = JSON.parse(storage.getItem('form')!) as PendingSubmission;
  await sendDurably(storage,'form',pending.url,pending.payload,async (_url,options) => {
    assert.equal((options?.headers as Record<string,string>)['X-Idempotency-Key'],pending.key);
    return Response.json({ id:'same-operation' },{ status:201 });
  });
});

test('JSON without a confirmation object remains ambiguous and keeps the original key', async () => {
  for (const body of [null, [], 'OK', 1]) {
    const storage = memory();
    await assert.rejects(sendDurably(storage,'form','/api/onion/shipment',{},async () => Response.json(body)), /nije potvrđen/);
    assert.ok(storage.getItem('form'));
  }
});
