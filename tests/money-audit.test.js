import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Prisma } from "@prisma/client";
import { money, rate, addMoney, subtractMoney, multiplyMoney, divideRate, numericDecimals } from "../lib/money.js";
import { prisma } from "../lib/prisma.js";
import { auth } from "../routes/auth.js";
import auditRouter from "../routes/auditLog.js";

test("money operations round in base 10 and keep API numbers without losing cents", () => {
  assert.equal(money(1.005), 1.01);
  assert.equal(money(-1.005), -1.01);
  assert.equal(addMoney(0.1, 0.2), 0.3);
  assert.equal(addMoney(...Array(100).fill(0.01)), 1);
  assert.equal(addMoney(1.005, 1.005), 2.02);
  assert.equal(subtractMoney(0.3, 0.1), 0.2);
  assert.equal(multiplyMoney(3, 0.335), 1.01);
  assert.equal(multiplyMoney(1, 1.005), 1.01);
  assert.equal(divideRate(1, 3), 0.3333);
  assert.equal(rate(12.12345), 12.1235);
  const date = new Date();
  assert.deepEqual(numericDecimals({ date, cost: new Prisma.Decimal("1.01"), rows: [{ wage: new Prisma.Decimal("3500.50") }] }), {
    date, cost: 1.01, rows: [{ wage: 3500.5 }],
  });
  assert.throws(() => numericDecimals(new Prisma.Decimal("10000000000000000.01")), RangeError);
  assert.throws(() => money(Infinity), RangeError);
});

test("audit list retains the original actor identity even when the account no longer exists", async () => {
  const session = mock.method(auth.api, "getSession", async () => ({ user: { id: "director", role: "DIREKTOR", isActive: true }, session: {} }));
  const original = { auditLog: prisma.auditLog, user: prisma.user };
  const rows = [
    { id: "history", userId: "deleted-user", userName: "Original name", userRole: "OPERATER", entityId: "fuel-id" },
    { id: "current", userId: "active-user", userName: "Earlier name", userRole: "OPERATER", entityId: "other-fuel" },
  ];
  prisma.auditLog = { async count() { return 2; }, async findMany(args) { assert.equal(args.include, undefined); return rows; } };
  prisma.user = { async findMany({ where }) {
    assert.deepEqual(where.id.in, ["deleted-user", "active-user"]);
    return [{ id: "active-user", name: "Current name" }];
  } };
  try {
    const response = await new Promise((resolve, reject) => auditRouter.handle({ method: "GET", url: "/", query: {}, headers: {} }, {
      status(code) { assert.equal(code, 200); return this; }, json(body) { resolve(body); },
    }, (error) => reject(error || new Error("Unhandled request"))));
    assert.equal(response.logs[0].user, null);
    assert.equal(response.logs[0].userId, "deleted-user");
    assert.equal(response.logs[0].userName, "Original name");
    assert.equal(response.logs[0].userRole, "OPERATER");
    assert.equal(response.logs[1].user.name, "Current name");
    assert.equal(response.logs[1].userName, "Earlier name");
  } finally {
    Object.assign(prisma, original); session.mock.restore();
  }
});
