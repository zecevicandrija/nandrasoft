import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import {
  buildWorkOrderInputFromProposal,
  proposalChange,
  proposalSchema,
  workerOverview,
  textSchema,
} from '../lib/directorCommunication.js';
import router from '../routes/communication.js';
import { auth } from '../routes/auth.js';
import { prisma } from '../lib/prisma.js';

const director = { id: 'director', name: 'Direktor', role: 'DIREKTOR', isActive: true };
const payload = { title: 'Oranje', orderDate: '2026-11-10', orderType: 'RAD_NJIVA', shift: 'PRVA', priority: 'NORMALNO' };
const proposal = { id: 'p', authorId: 'author', reviewerId: 'director', status: 'NA_PREGLEDU', version: 2, contentVersion: 1,
  data: { ...payload, title: 'Prvobitni posao' } };

test('approval captures actor and exact resulting version, including self-approval', () => {
  for (const id of ['director', 'author']) {
    const result = proposalChange(proposal, { action: 'approve', version: 2 }, { ...director, id });
    assert.equal(result.status, 'ODOBREN');
    assert.equal(result.approvedById, id);
    assert.equal(result.approvedVersion, 3);
    assert.ok(result.approvedAt instanceof Date);
  }
});
test('stale edits, unrelated reviewers and invalid transitions are rejected', () => {
  assert.throws(() => proposalChange(proposal, { action: 'approve', version: 1 }, director), { status: 409 });
  assert.throws(() => proposalChange(proposal, { action: 'approve', version: 2 }, { ...director, id: 'other' }), { status: 403 });
  assert.throws(() => proposalChange({ ...proposal, status: 'NACRT' }, { action: 'approve', version: 2 }, director), { status: 409 });
  assert.throws(() => proposalChange({ ...proposal, status: 'OTKAZAN' }, { action: 'edit', version: 2, data: payload }, director), { status: 409 });
  assert.throws(() => proposalChange(proposal, { action: 'cancel', version: 2 }, director), { status: 403 });
  assert.throws(() => proposalChange(proposal, { action: 'request-changes', version: 2, body: ' ' }, director), { status: 400 });
});
test('editing approved content clears approval and requires another review', () => {
  const result = proposalChange({ ...proposal, status: 'ODOBREN' }, { action: 'edit', version: 2, data: payload }, director);
  assert.equal(result.status, 'NACRT');
  assert.deepEqual(result.contentVersion, { increment: 1 });
  for (const field of ['approvedAt', 'approvedVersion', 'approvedById', 'approvedByName']) assert.equal(result[field], null);
});
test('saving identical content preserves version, status and approval', () => {
  const approved = { ...proposal, status: 'ODOBREN', approvedById: director.id, approvedVersion: 2,
    data: { ...proposalSchema.parse(payload), labels: { workerId: 'Display name' } } };
  assert.equal(proposalChange(approved, { action: 'edit', version: 2, data: payload }, director), null);
});
test('workflow actions preserve the content version', () => {
  for (const action of ['submit', 'approve', 'request-changes', 'cancel']) {
    const source = { ...proposal, ...(action === 'submit' ? { status: 'NACRT' } : {}) };
    const result = proposalChange(source, { action, version: 2, body: 'Potrebna dorada' }, { ...director, id: proposal.authorId });
    assert.equal(Object.hasOwn(result, 'contentVersion'), false);
    assert.deepEqual(result.version, { increment: 1 });
  }
});
test('all-director review allows another director and revision may be resubmitted', () => {
  assert.equal(proposalChange({ ...proposal, reviewerId: null }, { action: 'approve', version: 2 }, { ...director, id: 'other' }).status, 'ODOBREN');
  assert.equal(proposalChange({ ...proposal, status: 'VRACEN_NA_DORADU' }, { action: 'submit', version: 2, reviewerId: null }, director).status, 'NA_PREGLEDU');
});
test('validation rejects invalid dates, blank and oversized content and injected fields', () => {
  assert.equal(proposalSchema.safeParse(payload).success, true);
  for (const extra of [{ orderDate: '2026-02-30' }, { title: '  ' }, { plannedAreaHa: -1 }, { labels: { workerId: 'Forged worker' } }])
    assert.equal(proposalSchema.safeParse({ ...payload, ...extra }).success, false);
  assert.equal(textSchema.safeParse({ body: ' ' }).success, false);
  assert.equal(textSchema.safeParse({ body: 'a'.repeat(5001) }).success, false);
});
test('planned orders never establish presence and unknown workers remain visible', () => {
  const result = workerOverview([{ id: 'w', name: 'Worker' }, { id: 'empty', name: 'No records' }], [], [], [
    { id: 'o', workerId: 'w', status: 'DODELJEN', parcel: { id: 'p', name: 'Planned parcel' } },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].status, 'NEPOZNATO');
  assert.equal(result[0].planned.length, 1);
  assert.deepEqual(result[0].locations, []);
});
test('conflicting active locations are surfaced with original source times', () => {
  const result = workerOverview([{ id: 'w' }], [{ id: 'a', workerId: 'w', assignedAt: '2026-11-10', parcel: { id: 'p1' }, machine: { id: 'm' } }],
    [{ id: 'f', workerId: 'w', updatedAt: '2026-11-09', parcel: { id: 'p2' }, machine: { id: 'm' } }], []);
  assert.equal(result[0].status, 'PROVERA');
  assert.equal(result[0].locations.length, 2);
  assert.equal(result[0].machines.length, 1);
  assert.deepEqual(result[0].evidence.map(item => item.reportedAt), ['2026-11-10', '2026-11-09']);
});

function request(method, url, body) {
  const query = Object.fromEntries(new URL(url, 'http://localhost').searchParams.entries());
  return new Promise((resolve, reject) => {
    router.handle({ method, url, headers: {}, body, query }, {
      statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); },
    }, error => error ? reject(error) : resolve({ status: 404 }));
  });
}
test('sending a message notifies other directors but never the sender', async () => {
  const originalTransaction = prisma.$transaction;
  const authMock = mock.method(auth.api, 'getSession', async () => ({ user: director, session: {} }));
  const deliveries = [];
  let candidates = [{ id: director.id }, { id: 'other-director' }];
  prisma.$transaction = async fn => fn({
    directorMessage: {
      create: async ({ data }) => {
        assert.equal(data.authorId, director.id);
        return { id: 'new-message', ...data };
      },
    },
    user: {
      findMany: async ({ where }) => {
        assert.equal(where.role, 'DIREKTOR');
        assert.equal(where.isActive, true);
        assert.equal(where.id.not, director.id);
        return candidates;
      },
    },
    directorNotification: { createMany: async ({ data }) => { deliveries.push(...data); } },
  });
  try {
    const result = await request('POST', '/messages', { body: 'Dogovor direktora' });
    assert.equal(result.status, 201);
    assert.deepEqual(deliveries.map(item => item.userId), ['other-director']);
    assert.equal(deliveries[0].messageId, result.data.id);
    candidates = [{ id: director.id }];
    deliveries.length = 0;
    assert.equal((await request('POST', '/messages', { body: 'Nova poruka' })).status, 201);
    assert.deepEqual(deliveries, []);
  } finally { prisma.$transaction = originalTransaction; authMock.mock.restore(); }
});
test('all communication endpoints enforce active director session before data access', async () => {
  let session = null;
  const authMock = mock.method(auth.api, 'getSession', async () => session);
  try {
    for (const [method, url] of [['GET', '/overview'], ['GET', '/catalog'], ['GET', '/messages'], ['POST', '/messages'],
      ['GET', '/proposals/p'], ['POST', '/proposals'], ['PATCH', '/proposals/p'], ['POST', '/proposals/p/comments'], ['POST', '/proposals/p/convert'], ['GET', '/notifications'], ['POST', '/notifications/read-all'], ['POST', '/notifications/n/read']]) {
      session = null;
      assert.equal((await request(method, url, {})).status, 401);
      for (const role of ['OPERATER', 'RUKOVODILAC', 'MAGACIN', 'MEHANICAR']) {
        session = { user: { ...director, role }, session: {} };
        assert.equal((await request(method, url, {})).status, 403);
      }
      session = { user: { ...director, isActive: false }, session: {} };
      assert.equal((await request(method, url, {})).status, 403);
    }
  } finally { authMock.mock.restore(); }
});
test('submitting and resubmitting proposals publishes linked messages, while editing does not', async () => {
  const originalTransaction = prisma.$transaction;
  const authMock = mock.method(auth.api, 'getSession', async () => ({ user: director, session: {} }));
  let stored = { ...proposal, status: 'NACRT', data: payload };
  const messages = [];
  const notifications = [];
  prisma.$transaction = async fn => fn({
    workOrderProposal: {
      findUniqueOrThrow: async () => structuredClone(stored),
      updateMany: async ({ data }) => {
        stored = { ...stored, ...data, version: stored.version + 1,
          contentVersion: stored.contentVersion + (data.contentVersion?.increment || 0) };
        return { count: 1 };
      },
    },
    proposalEvent: { create: async () => ({}) },
    directorMessage: { create: async ({ data }) => { messages.push(data); return data; } },
    user: { findMany: async () => [{ id: director.id }, { id: 'other' }] },
    directorNotification: { createMany: async ({ data }) => { notifications.push(...data); } },
  });
  try {
    const submitted = await request('PATCH', '/proposals/p', { action: 'submit', version: 2 });
    assert.equal(submitted.status, 200);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].proposalId, 'p');
    assert.equal(messages[0].proposalVersion, 3);
    assert.equal(messages[0].authorId, director.id);
    assert.ok(messages[0].body.includes(payload.title));
    assert.ok(messages[0].body.endsWith('Verzija: 1'));
    assert.deepEqual(notifications.map(item => item.userId), ['other']);
    assert.equal((await request('PATCH', '/proposals/p', { action: 'submit', version: 2 })).status, 409);
    assert.equal(messages.length, 1);
    assert.equal((await request('PATCH', '/proposals/p', { action: 'edit', version: 3, data: payload })).status, 200);
    assert.equal(stored.version, 3);
    assert.equal(stored.status, 'NA_PREGLEDU');
    assert.equal((await request('PATCH', '/proposals/p', { action: 'edit', version: 3, data: { ...payload, title: 'Novi posao' } })).status, 200);
    assert.equal(messages.length, 1);
    assert.equal((await request('PATCH', '/proposals/p', { action: 'submit', version: 4 })).status, 200);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].proposalVersion, 5);
    assert.ok(messages[1].body.endsWith('Verzija: 2'));
  } finally { prisma.$transaction = originalTransaction; authMock.mock.restore(); }
});
test('conditional update rejects concurrent loser without creating history or notifications', async () => {
  const original = prisma.$transaction;
  const authMock = mock.method(auth.api, 'getSession', async () => ({ user: director, session: {} }));
  let writes = 0;
  prisma.$transaction = async fn => fn({ workOrderProposal: {
    findUniqueOrThrow: async () => proposal,
    updateMany: async args => { assert.equal(args.where.version, 2); return { count: 0 }; },
  }, proposalEvent: { create: async () => { writes++; } }, directorNotification: { createMany: async () => { writes++; } } });
  try {
    const result = await request('PATCH', '/proposals/p', { action: 'approve', version: 2 });
    assert.equal(result.status, 409);
    assert.equal(writes, 0);
  } finally { prisma.$transaction = original; authMock.mock.restore(); }
});
test('comments preserve approval and notification read is scoped to recipient', async () => {
  const originalTransaction = prisma.$transaction;
  const originalNotification = prisma.directorNotification;
  const authMock = mock.method(auth.api, 'getSession', async () => ({ user: director, session: {} }));
  const saved = [];
  prisma.$transaction = async fn => fn({
    workOrderProposal: { findUniqueOrThrow: async () => ({ ...proposal, status: 'ODOBREN', data: { title: 'Test' } }) },
    proposalEvent: { create: async ({ data }) => { saved.push(data); return data; } },
    user: { findMany: async () => [] },
  });
  prisma.directorNotification = { updateMany: async args => { assert.equal(args.where.userId, director.id); return { count: 0 }; } };
  try {
    assert.equal((await request('POST', '/proposals/p/comments', { body: 'Dodatni dogovor' })).status, 201);
    assert.equal(saved[0].version, 2);
    assert.equal(saved[0].action, 'comment');
    assert.equal((await request('POST', '/notifications/other-users-notice/read', {})).status, 200);
  } finally { prisma.$transaction = originalTransaction; prisma.directorNotification = originalNotification; authMock.mock.restore(); }
});
test('marking all notifications as read only updates the current director unread notices', async () => {
  const originalNotification = prisma.directorNotification;
  const authMock = mock.method(auth.api, 'getSession', async () => ({ user: director, session: {} }));
  let capturedArgs = null;
  prisma.directorNotification = { updateMany: async args => { capturedArgs = args; return { count: 3 }; } };
  try {
    const result = await request('POST', '/notifications/read-all', {});
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { ok: true });
    assert.equal(capturedArgs.where.userId, director.id);
    assert.equal(capturedArgs.where.readAt, null);
    assert.ok(capturedArgs.data.readAt instanceof Date);
  } finally { prisma.directorNotification = originalNotification; authMock.mock.restore(); }
});


test('converted proposals cannot be edited or cancelled and mapping builds valid work order input', () => {
  const converted = { ...proposal, status: 'ODOBREN', workOrderId: 'wo-1', version: 4 };
  assert.throws(() => proposalChange(converted, { action: 'edit', version: 4, data: payload }, director), { status: 409 });
  assert.throws(() => proposalChange(converted, { action: 'cancel', version: 4 }, { ...director, id: proposal.authorId }), { status: 409 });

  const photo = 'https://nandra.b-cdn.net/fotografije/2026/11/foto_11111111-1111-4111-8111-111111111111.jpg';
  const parsed = proposalSchema.parse({
    ...payload,
    workerId: 'w-1',
    contractorId: 'c-prop',
    photoUrl: photo,
    workMaterials: [{ kind: 'FERTILIZER', productId: 'fert-1', dosePerHa: 300, notes: null }],
  });
  assert.equal(parsed.contractorId, 'c-prop');
  assert.equal(parsed.photoUrl, photo);
  assert.equal(parsed.workMaterials.length, 1);

  const inherited = buildWorkOrderInputFromProposal(parsed, {});
  assert.equal(inherited.contractorId, 'c-prop');
  assert.equal(inherited.photoUrl, photo);
  assert.equal(inherited.materials.length, 1);

  const mapped = buildWorkOrderInputFromProposal(
    { ...payload, workerId: 'w-1', machineId: 'm-1', parcelId: 'p-1', workTypeId: 'wt-1', materials: 'NPK 300kg/ha', instructions: 'Duboko oranje' },
    { contractorId: 'c-1' }
  );
  assert.equal(mapped.workerId, 'w-1');
  assert.equal(mapped.contractorId, 'c-1');
  assert.ok(mapped.instructions.includes('Oranje'));
  assert.ok(mapped.instructions.includes('Duboko oranje'));
  assert.ok(mapped.instructions.includes('Materijali: NPK 300kg/ha'));
});

test('POST /proposals/:id/convert validates preconditions and converts approved proposals once', async () => {
  const originalTransaction = prisma.$transaction;
  const authMock = mock.method(auth.api, 'getSession', async () => ({ user: director, session: {} }));

  const events = [];
  const audits = [];
  const notifications = [];
  const machineUpdates = [];
  const maintenanceCreates = [];

  let currentProposal = {
    ...proposal,
    id: 'prop-approved',
    status: 'ODOBREN',
    version: 3,
    contentVersion: 2,
    approvedById: director.id,
    approvedByName: director.name,
    approvedAt: new Date(),
    workOrderId: null,
    data: {
      ...payload,
      workerId: 'worker-1',
      machineId: 'machine-1',
      parcelId: 'parcel-1',
      workTypeId: 'wt-1',
      materials: '',
      instructions: 'Izvesti odmah ujutru',
    },
  };

  prisma.$transaction = async (fn) => fn({
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ lastValue: 7 }],
    machineAssignment: {},
    fuelEntry: {},
    fieldWork: {},
    workOrderProposal: {
      findUnique: async ({ where }) => (where.id === currentProposal.id ? structuredClone(currentProposal) : null),
      updateMany: async ({ where, data }) => {
        if (
          where.id === currentProposal.id &&
          where.version === currentProposal.version &&
          where.status === 'ODOBREN' &&
          where.workOrderId === null &&
          !currentProposal.workOrderId
        ) {
          assert.equal(data.approvedVersion, currentProposal.version + 1);
          currentProposal = {
            ...currentProposal,
            version: currentProposal.version + 1,
            approvedVersion: data.approvedVersion,
          };
          return { count: 1 };
        }
        return { count: 0 };
      },
      update: async ({ where, data }) => {
        assert.equal(where.id, currentProposal.id);
        currentProposal = { ...currentProposal, ...data };
        return structuredClone(currentProposal);
      },
    },
    worker: {
      findUnique: async ({ where }) => where.id === 'warehouse-worker'
        ? { id: where.id, type: 'STALNI', isActive: true, user: { role: 'MAGACIN', isActive: true } }
        : where.id === 'worker-1' ? { id: where.id, name: 'Pera Operater', isActive: true } : null,
    },
    machine: {
      findUnique: async ({ where }) => (where.id === 'machine-1' ? { id: 'machine-1', name: 'John Deere 6155M', isActive: true, updatedAt: new Date() } : null),
      update: async ({ data }) => { machineUpdates.push(data); return { id: 'machine-1', ...data }; },
    },
    parcel: {
      findUnique: async ({ where }) => (where.id === 'parcel-1' ? { id: 'parcel-1', name: 'Tabla 1', isActive: true } : null),
    },
    workType: {
      findUnique: async ({ where }) => (where.id === 'wt-1' ? { id: 'wt-1', name: 'Oranje', isActive: true, materialKind: null, materialRequired: false } : null),
    },
    contractor: {
      findUnique: async () => null,
    },
    onionLot: { findUnique: async ({ where }) => where.id === 'lot-1' ? { id: where.id } : null },
    maintenanceIssue: {
      create: async ({ data }) => { maintenanceCreates.push(data); return { id: 'maint-1', ...data }; },
    },
    workOrder: {
      create: async ({ data }) => ({
        id: 'wo-created-1',
        ...data,
        worker: { id: data.workerId, name: 'Pera Operater' },
        machine: data.machineId ? { id: data.machineId, name: 'John Deere 6155M' } : null,
        attachment: null,
        parcel: data.parcelId ? { id: data.parcelId, name: 'Tabla 1' } : null,
        contractor: null,
        workType: data.workTypeId ? { id: data.workTypeId, name: 'Oranje' } : null,
        materials: [],
      }),
    },
    auditLog: {
      create: async ({ data }) => { audits.push(data); return data; },
    },
    proposalEvent: {
      create: async ({ data }) => { events.push(data); return data; },
    },
    user: {
      findMany: async () => [{ id: 'other-dir' }],
    },
    directorNotification: {
      createMany: async ({ data }) => { notifications.push(...data); },
    },
  });

  try {
    // 1. Not found
    assert.equal((await request('POST', '/proposals/missing/convert', {})).status, 404);

    // 2. Non-approved proposal rejected
    const savedStatus = currentProposal.status;
    currentProposal.status = 'NA_PREGLEDU';
    assert.equal((await request('POST', '/proposals/prop-approved/convert', { version: 3 })).status, 409);
    currentProposal.status = savedStatus;

    // 3. Missing workerId rejected with 400 without mutating proposal
    const savedWorkerId = currentProposal.data.workerId;
    currentProposal.data.workerId = null;
    assert.equal((await request('POST', '/proposals/prop-approved/convert', { version: 3 })).status, 400);
    assert.equal(currentProposal.version, 3);
    currentProposal.data.workerId = savedWorkerId;

    // 4. Valid 1-click conversion succeeds and links work order
    const converted = await request('POST', '/proposals/prop-approved/convert', { version: 3 });
    assert.equal(converted.status, 201);
    assert.equal(converted.data.workOrder.id, 'wo-created-1');
    assert.equal(converted.data.workOrder.status, 'DODELJEN');
    assert.match(converted.data.workOrder.orderNumber, /^RN-\d{4}-0007$/);
    assert.equal(converted.data.proposal.workOrderId, 'wo-created-1');
    assert.equal(converted.data.proposal.convertedOrderNumber, converted.data.workOrder.orderNumber);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].entityType, 'WorkOrder');
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'convert');
    assert.deepEqual(notifications.map(n => n.userId), ['other-dir']);

    // 5. Duplicate conversion attempt fails with 409
    assert.equal((await request('POST', '/proposals/prop-approved/convert', { version: 4 })).status, 409);

    // 6. REMONT_SERVIS proposal also opens a maintenance issue with serviceType and updates machine status to SERVIS
    currentProposal = {
      ...currentProposal,
      id: 'prop-service',
      version: 1,
      workOrderId: null,
      convertedOrderNumber: null,
      data: {
        ...payload,
        orderType: 'REMONT_SERVIS',
        serviceType: 'GENERALNI_REMONT',
        priority: 'KRITICNA',
        workerId: 'worker-1',
        machineId: 'machine-1',
        parcelId: 'parcel-1',
        attachmentId: 'attach-1',
        workTypeId: 'wt-1',
        plannedAreaHa: 12,
        instructions: 'Zamena filtera i generalni remont',
      },
    };
    const serviceResult = await request('POST', '/proposals/prop-service/convert', { version: 1 });
    assert.equal(serviceResult.status, 201);
    assert.equal(maintenanceCreates.length, 1);
    assert.equal(maintenanceCreates[0].serviceType, 'GENERALNI_REMONT');
    assert.equal(maintenanceCreates[0].priority, 'KRITICNA');
    assert.match(maintenanceCreates[0].title, /^Radni nalog RN-\d{4}-0007: Oranje$/);
    assert.equal(maintenanceCreates[0].description, 'Zamena filtera i generalni remont');
    assert.equal(serviceResult.data.workOrder.parcelId, null);
    assert.equal(serviceResult.data.workOrder.attachmentId, null);
    assert.equal(serviceResult.data.workOrder.workTypeId, null);
    assert.equal(serviceResult.data.workOrder.plannedAreaHa, null);
    assert.equal(machineUpdates.some(u => u.status === 'SERVIS'), true);

    const packingPlan = {
      entryMode: 'both',
      sortingForm: { inputQuantityKg: '110', qualityQuantityKg: '100', smallQuantityKg: '8', wasteQuantityKg: '1', plevaKg: '1' },
      packagingForm: { date: payload.orderDate, lotId: 'lot-1', packageType: 'DZAK_10KG', unitWeightKg: '10',
        packageCount: '10', palletsCount: '1', palletNumber: 'P01', packerCount: '2', responsiblePerson: 'Pera',
        packerNotes: 'Prva smena', notes: '' },
    };
    currentProposal = { ...currentProposal, id: 'prop-packing', version: 1, workOrderId: null, convertedOrderNumber: null,
      data: proposalSchema.parse({ ...payload, orderType: 'PAKOVANJE', packingPlan }) };
    const packingResult = await request('POST', '/proposals/prop-packing/convert', { version: 1, workerId: 'warehouse-worker' });
    assert.equal(packingResult.status, 201);
    assert.deepEqual(packingResult.data.workOrder.packingPlan, packingPlan);
    assert.equal(packingResult.data.workOrder.orderType, 'PAKOVANJE');
    assert.equal(packingResult.data.workOrder.status, 'DODELJEN');
    assert.equal(packingResult.data.proposal.workOrderId, packingResult.data.workOrder.id);
    assert.deepEqual(events.at(-1).snapshot.packingPlan, packingPlan);
    assert.equal(notifications.at(-1).proposalId, 'prop-packing');
  } finally {
    prisma.$transaction = originalTransaction;
    authMock.mock.restore();
  }
});

test('GET /proposals defaults to 10 items per page and passes skip/take from requested page', async () => {
  const originalProposal = prisma.workOrderProposal;
  const authMock = mock.method(auth.api, 'getSession', async () => ({ user: director, session: {} }));
  const findManyCalls = [];
  const countCalls = [];

  prisma.workOrderProposal = {
    findMany: async args => {
      findManyCalls.push(args);
      return [{ ...proposal, id: 'prop-page-2' }];
    },
    count: async args => {
      countCalls.push(args);
      return args?.where?.workOrderId === null ? 2 : 23;
    },
  };

  try {
    const res = await request('GET', '/proposals?status=ODOBREN&page=2');
    assert.equal(res.status, 200);
    assert.equal(findManyCalls.length, 1);
    assert.equal(findManyCalls[0].skip, 10);
    assert.equal(findManyCalls[0].take, 10);
    assert.deepEqual(findManyCalls[0].where, { status: 'ODOBREN' });
    assert.equal(countCalls.length, 2);
    assert.equal(res.data.page, 2);
    assert.equal(res.data.pageSize, 10);
    assert.equal(res.data.total, 23);
    assert.equal(res.data.totalPages, 3);
    assert.equal(res.data.approvedPendingCount, 2);
    assert.equal(res.data.items.length, 1);

    const typedRes = await request('GET', '/proposals?status=ODOBREN&orderType=REMONT_SERVIS');
    assert.equal(typedRes.status, 200);
    assert.deepEqual(findManyCalls[1].where, {
      status: 'ODOBREN',
      data: { path: ['orderType'], equals: 'REMONT_SERVIS' },
    });
  } finally {
    prisma.workOrderProposal = originalProposal;
    authMock.mock.restore();
  }
});

test('directors can delete any unconverted proposal, including approved proposals, only at the confirmed version', async () => {
  const original = prisma.$transaction;
  const session = mock.method(auth.api, 'getSession', async () => ({ user: director, session: {} }));
  const cleanup = [];
  let row;
  prisma.$transaction = async fn => fn({
    workOrderProposal: {
      deleteMany: async ({ where }) => {
        if (!row || !Object.entries(where).every(([key, value]) => row[key] === value)) return { count: 0 };
        row = null;
        return { count: 1 };
      },
      findUnique: async () => row,
    },
    directorMessage: { updateMany: async args => cleanup.push(args) },
    directorNotification: { deleteMany: async args => cleanup.push(args) },
  });
  const pending = { id: 'p', version: 4, workOrderId: null, convertedAt: null, convertedOrderNumber: null };
  const remove = version => request('DELETE', '/proposals/p', { version });
  try {
    for (const status of ['NACRT', 'NA_PREGLEDU', 'VRACEN_NA_DORADU', 'ODOBREN', 'OTKAZAN']) {
      row = { ...pending, status };
      cleanup.length = 0;
      assert.equal((await remove(3)).status, 409);
      assert.equal(cleanup.length, 0);
      assert.equal((await remove(4)).status, 200);
      assert.equal(row, null);
      assert.deepEqual(cleanup, [
        { where: { proposalId: 'p' }, data: { proposalId: null, proposalVersion: null } },
        { where: { proposalId: 'p' } },
      ]);
      assert.equal((await remove(4)).status, 200);
    }
    cleanup.length = 0;
    for (const conversion of [{ workOrderId: 'wo' }, { convertedAt: new Date() }, { convertedOrderNumber: 'RN-1' }]) {
      row = { ...pending, ...conversion };
      assert.equal((await remove(4)).status, 409);
      assert.ok(row);
    }
    assert.equal(cleanup.length, 0);
  } finally {
    prisma.$transaction = original;
    session.mock.restore();
  }
});
