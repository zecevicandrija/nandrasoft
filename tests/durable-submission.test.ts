import assert from "node:assert/strict";
import { test } from "node:test";
import { sendDurably, submissionKey } from "../src/lib/durableSubmission.ts";

const memory = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("lost response and page reload retain exactly the same payload and request key", async () => {
  const storage = memory(), key = submissionKey("worker", "field-work:order");
  const payload = { machineId: "m", endHours: 12, notes: "Repaired" };
  let sent;
  await assert.rejects(sendDurably(storage, key, "/api/field-work", payload, async (url, options) => {
    sent = { url, options }; throw new TypeError("Network lost after commit");
  }), /Podaci su sačuvani/);
  const pending = JSON.parse(storage.getItem(key));
  assert.deepEqual(pending.payload, payload);
  const result = await sendDurably(storage, key, pending.url, pending.payload, async (url, options) => {
    assert.equal(url, sent.url);
    assert.equal(options.headers["Idempotency-Key"], sent.options.headers["Idempotency-Key"]);
    assert.equal(options.body, sent.options.body);
    return json({ work: { id: "one-work" } }, 201);
  });
  assert.equal(result.work.id, "one-work");
  assert.ok(storage.getItem(key), "keep key until the form acknowledges success and clears its draft");
});

test("ambiguous request cannot silently become a different operation", async () => {
  const storage = memory();
  await assert.rejects(sendDurably(storage, "form", "/api/checkin", { hours: 12 }, async () => { throw new Error("offline"); }));
  let called = false;
  await assert.rejects(sendDurably(storage, "form", "/api/checkin", { hours: 13 }, async () => { called = true; return json({}); }), /Ponovi prethodno slanje/);
  assert.equal(called, false);
});

test("validation/conflict allows correction, while server errors and invalid responses retain the key", async () => {
  for (const status of [400, 404, 409, 422, 401, 403, 500, 503]) {
    const storage = memory();
    await assert.rejects(sendDurably(storage, "form", "/api/work", {}, async () => json({ error: "Rejected" }, status)), /Rejected/);
    assert.equal(Boolean(storage.getItem("form")), ![400, 404, 409, 422].includes(status));
  }
  const storage = memory();
  await assert.rejects(sendDurably(storage, "form", "/api/work", {}, async () => new Response("bad gateway")), /Ponovite/);
  assert.ok(storage.getItem("form"));
  await assert.rejects(sendDurably(storage, "form", "/api/work", {}, async () => json({ code: "IDEMPOTENCY_MISMATCH" }, 409)));
  assert.ok(storage.getItem("form"));
});

test("storage failure stops submission before any network request; drafts are isolated by user and form", async () => {
  let called = false;
  const storage = memory(); storage.setItem = () => { throw new Error("Storage denied"); };
  await assert.rejects(sendDurably(storage, "form", "/api/work", {}, async () => { called = true; return json({}); }), /Storage denied/);
  assert.equal(called, false);
  assert.notEqual(submissionKey("a", "checkin"), submissionKey("b", "checkin"));
  assert.notEqual(submissionKey("a", "checkin"), submissionKey("a", "field-work"));
});

test("fuel and seasonal forms preserve the exact key and original data across concurrent sends and reload", async () => {
  for (const [scope, url, payload] of [
    ["fuel-entry", "/api/fuel/entries", { liters: 15, totalCost: 3000, date: "2026-10-31T10:12:13.456Z" }],
    ["seasonal-group-log", "/api/seasonal/logs/group", { workerIds: ["a", "b"], dailyWage: 3000, date: "2026-10-31" }],
    ["seasonal-single-log", "/api/seasonal/logs", { seasonalWorkerId: "a", dailyWageApplied: 3000 }],
  ] as const) {
    const storage = memory(), key = submissionKey("manager", scope);
    const sent: RequestInit[] = [];
    const offline = async (_url, options) => { sent.push(options); throw new Error("lost response"); };
    await Promise.allSettled([
      sendDurably(storage, key, url, payload, offline),
      sendDurably(storage, key, url, payload, offline),
    ]);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0], sent[1]);
    const pending = JSON.parse(storage.getItem(key));
    assert.deepEqual(pending.payload, payload);
    await sendDurably(storage, key, pending.url, pending.payload, async (_url, options) => {
      assert.equal(options.body, sent[0].body);
      assert.deepEqual(options.headers, sent[0].headers);
      return json({ success: true }, 201);
    });
    storage.removeItem(key); // The form acknowledges success.
    await sendDurably(storage, key, url, payload, async (_url, options) => {
      assert.notDeepEqual(options.headers, sent[0].headers, "an intentional new entry gets a new key");
      return json({ success: true }, 201);
    });
  }
});
