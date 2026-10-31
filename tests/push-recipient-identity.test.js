import assert from "node:assert/strict";
import { test, mock } from "node:test";
import webpush from "web-push";
import { prisma } from "../lib/prisma.js";

test("work order notifications use only explicit worker-user IDs", async (t) => {
  // Configure the real delivery path with temporary test keys; all sends are mocked.
  const previousEnv = {
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  };
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:test@example.test";
  const originals = { worker: prisma.worker, user: prisma.user, pushSubscription: prisma.pushSubscription };
  const sends = [];
  const reads = [];
  let nameLookups = 0;
  let updates = 0;
  const workers = [
    { id: "other", name: "Same Name", userId: "other-user" },
    { id: "assigned", name: "Same Name", userId: "assigned-user" },
    { id: "unlinked", name: "Same Name", userId: null },
  ];
  const subscriptions = [
    { userId: "other-user", endpoint: "https://push.example.test/other", p256dh: "test", auth: "test" },
    { userId: "assigned-user", endpoint: "https://push.example.test/phone", p256dh: "test", auth: "test" },
    { userId: "assigned-user", endpoint: "https://push.example.test/laptop", p256dh: "test", auth: "test" },
  ];
  const delivery = mock.method(webpush, "generateRequestDetails", (subscription, payload) => {
    return { endpoint: subscription.endpoint, method: "POST", headers: {}, body: payload };
  });
  const transport = mock.method(globalThis, "fetch", async (endpoint, options) => {
    sends.push({ endpoint, payload: JSON.parse(options.body) });
    return new Response(null, { status: 201 });
  });
  prisma.worker = {
    async findUnique({ where }) { return workers.find((worker) => worker.id === where.id) || null; },
    async update() { updates++; return {}; },
  };
  prisma.user = {
    async findFirst() { nameLookups++; return { id: "other-user" }; },
  };
  prisma.pushSubscription = {
    async findMany({ where }) {
      reads.push(where);
      return subscriptions.filter((subscription) => subscription.userId === where.userId);
    },
  };
  try {
    const { sendWorkOrderPushNotification } = await import("../lib/pushNotification.js");
    const order = { id: "order-1", orderNumber: "RN-1" };
    await t.test("same-name colleagues cannot receive the assigned worker's notification, including after rename", async () => {
      for (const name of ["Same Name", "Renamed Worker"]) {
        workers[1].name = name;
        sends.length = 0;
        assert.deepEqual(await sendWorkOrderPushNotification("assigned", order), { sent: 2, failed: 0 });
        assert.deepEqual(reads.at(-1), { userId: "assigned-user" });
        assert.deepEqual(sends.map((send) => send.endpoint), subscriptions.slice(1).map((sub) => sub.endpoint));
        for (const send of sends) {
          assert.equal(send.payload.orderId, order.id);
          assert.equal(send.payload.orderNumber, order.orderNumber);
        }
      }
    });
    await t.test("unlinked, missing and unspecified workers cause no subscription lookup or send", async () => {
      const beforeReads = reads.length;
      sends.length = 0;
      for (const id of ["unlinked", "missing", null, undefined]) {
        assert.deepEqual(await sendWorkOrderPushNotification(id, order), { sent: 0, failed: 0 });
      }
      assert.equal(reads.length, beforeReads);
      assert.equal(sends.length, 0);
      assert.equal(workers[2].userId, null);
    });
    assert.equal(nameLookups, 0);
    assert.equal(updates, 0);
  } finally {
    delivery.mock.restore();
    transport.mock.restore();
    Object.assign(prisma, originals);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
