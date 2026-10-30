import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { auth } from "../routes/auth.js";
import usersRouter from "../routes/users.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { verifyPassword } from "better-auth/crypto";
import { migrateUserSecurity } from "../scripts/migrate-user-security.js";

// Exercise Better Auth's real HTTP handler with the application's user schema,
// without connecting to or modifying the application's database.
function createTestAuth() {
  const database = { user: [], session: [], account: [], verification: [] };
  const instance = betterAuth({
    baseURL: "http://localhost:5000",
    secret: "test-only-secret-at-least-thirty-two-characters",
    database: memoryAdapter(database),
    emailAndPassword: auth.options.emailAndPassword,
    user: auth.options.user,
    databaseHooks: auth.options.databaseHooks,
    trustedOrigins: ["http://localhost:5000"],
    rateLimit: { enabled: false },
  });
  return { instance, database };
}

function post(instance, path, body, cookie) {
  return instance.handler(new Request(`http://localhost:5000/api/auth/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:5000",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  }));
}

test("public sign-up cannot choose any privileged role", async () => {
  const { instance, database } = createTestAuth();
  for (const role of ["DIREKTOR", "RUKOVODILAC", "MAGACIN", "MEHANICAR"]) {
    const response = await post(instance, "sign-up/email", {
      name: "Test User", email: `${role.toLowerCase()}@example.com`,
      password: "test-password-123", role,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.role, "OPERATER");
    assert.equal(database.user.at(-1).role, "OPERATER");
  }
});

test("self-service updates cannot change role; ordinary profile updates still work", async () => {
  const { instance, database } = createTestAuth();
  const signup = await post(instance, "sign-up/email", {
    name: "Test User", email: "worker@example.com", password: "test-password-123",
  });
  assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  assert.ok(cookie);

  for (const role of ["DIREKTOR", "RUKOVODILAC", "MAGACIN", "MEHANICAR"]) {
    const response = await post(instance, "update-user", { role }, cookie);
    assert.equal(response.status, 400);
    assert.equal(database.user[0].role, "OPERATER");
  }
  const pinChange = await post(instance, "update-user", { pin: "1234" }, cookie);
  assert.equal(pinChange.status, 400);
  assert.ok(!database.user[0].pin);
  const response = await post(instance, "update-user", { name: "Updated Name" }, cookie);
  assert.equal(response.status, 200);
  assert.equal(database.user[0].name, "Updated Name");
  assert.equal(database.user[0].role, "OPERATER");
});

// Drive the actual Express router, including both authorization middleware.
function userRequest(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers, body };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); },
    };
    usersRouter.handle(req, res, (error) => reject(error || new Error("Unhandled request")));
  });
}

const createUser = (body) => userRequest("POST", "/", body);

test("only a director can provision a user with a server-assigned role", async () => {
  const body = {
    name: "New Director", email: "new-director@example.com",
    password: "test-password-123", role: "DIREKTOR",
    pin: "2468",
  };
  let session = null;
  const writes = [];
  const transaction = {
    session: { async deleteMany(args) { writes.push(["revoke", args]); } },
    user: { async update(args) { writes.push(["role", args]); return { id: "new-user", role: args.data.role }; } },
    worker: { async create(args) { writes.push(["worker", args]); } },
  };
  // Prisma exposes methods through a proxy; replace them directly rather than
  // using mock.method, which requires a property descriptor for the method.
  const originalTransaction = prisma.$transaction;
  const originalWorker = prisma.worker;
  prisma.$transaction = async (fn) => fn(transaction);
  prisma.worker = {
    async findFirst() { return { id: "worker" }; },
    async update() { return {}; },
  };
  const mocks = [
    mock.method(auth.api, "getSession", async () => session),
    mock.method(auth.api, "signUpEmail", async ({ body: input }) => {
      assert.equal(Object.hasOwn(input, "role"), false);
      assert.equal(Object.hasOwn(input, "pin"), false);
      writes.push(["signup"]);
      return { user: { id: "new-user", name: input.name, email: input.email, role: "OPERATER" } };
    }),
  ];
  try {
    assert.equal((await createUser(body)).status, 401);
    session = { user: { id: "operator", role: "OPERATER", isActive: true }, session: {} };
    assert.equal((await createUser(body)).status, 403);
    assert.deepEqual(writes, []);
    session = { user: { id: "director", role: "DIREKTOR", isActive: true }, session: {} };
    const response = await createUser(body);
    assert.equal(response.status, 201);
    assert.equal(response.data.user.role, "DIREKTOR");
    const storedPin = writes[2][1].data.pin;
    assert.equal(await verifyPassword({ hash: storedPin, password: "2468" }), true);
    assert.deepEqual(writes, [
      ["signup"],
      ["revoke", { where: { userId: "new-user" } }],
      ["role", { where: { id: "new-user" }, data: { role: "DIREKTOR", pin: storedPin } }],
      ["worker", { data: { name: "New Director", type: "STALNI", phone: null, isActive: true, userId: "new-user" } }],
    ]);
  } finally {
    for (const method of mocks) method.mock.restore();
    prisma.$transaction = originalTransaction;
    prisma.worker = originalWorker;
  }
});

test("legacy PIN migration previews without writing and is safe to repeat", async () => {
  const rows = [{ id: "legacy", pin: "1234" }, { id: "existing-hash", pin: "already-hashed-value" }];
  let sessions = 3;
  const db = {
    user: {
      async findMany() { return structuredClone(rows); },
      async updateMany({ where, data }) {
        const row = rows.find((user) => user.id === where.id && user.pin === where.pin);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    session: {
      async count({ where }) { assert.equal(where.user.isActive, false); return sessions; },
      async deleteMany({ where }) {
        assert.equal(where.user.isActive, false);
        const count = sessions;
        sessions = 0;
        return { count };
      },
    },
  };
  assert.deepEqual(await migrateUserSecurity(db), {
    apply: false, legacyPins: 1, inactiveSessions: 3, pinsHashed: 0, sessionsRevoked: 0,
  });
  assert.equal(rows[0].pin, "1234");
  const applied = await migrateUserSecurity(db, { apply: true });
  assert.equal(applied.pinsHashed, 1);
  assert.equal(applied.sessionsRevoked, 3);
  assert.equal(await verifyPassword({ hash: rows[0].pin, password: "1234" }), true);
  assert.equal(rows[1].pin, "already-hashed-value");
  const repeated = await migrateUserSecurity(db, { apply: true });
  assert.equal(repeated.pinsHashed, 0);
  assert.equal(repeated.sessionsRevoked, 0);
});

test("inactive users are denied by authentication and role guards", async () => {
  const sessionMock = mock.method(auth.api, "getSession", async (options) => {
    assert.equal(options.query.disableCookieCache, true);
    return { user: { id: "inactive", role: "DIREKTOR", isActive: false }, session: {} };
  });
  let advanced = false;
  const res = {
    status(code) { this.statusCode = code; return this; },
    json() {},
  };
  try {
    await requireAuth({ headers: {} }, res, () => { advanced = true; });
    assert.equal(res.statusCode, 403);
    assert.equal(advanced, false);
    requireRole(["DIREKTOR"])(
      { user: { role: "DIREKTOR", isActive: false } }, res, () => { advanced = true; },
    );
    assert.equal(res.statusCode, 403);
    assert.equal(advanced, false);
  } finally {
    sessionMock.mock.restore();
  }
});

test("deactivation and password reset revoke every device session; PINs stay private", async () => {
  const { instance, database } = createTestAuth();
  const signup = await post(instance, "sign-up/email", {
    name: "Worker", email: "lifecycle@example.com", password: "original-password",
  });
  const workerId = (await signup.json()).user.id;
  const login = await post(instance, "sign-in/email", {
    email: "lifecycle@example.com", password: "original-password",
  });
  assert.equal(login.status, 200);
  const cookies = [signup, login].map((response) => response.headers.getSetCookie()
    .map((value) => value.split(";")[0]).join("; "));
  assert.equal(database.session.length, 2);
  const ctx = await instance.$context;
  const adminSession = { user: { id: "admin", role: "DIREKTOR", isActive: true }, session: {} };
  const sessionMock = mock.method(auth.api, "getSession", async (options) => {
    if (options.headers.admin === "test") return adminSession;
    return instance.api.getSession(options);
  });
  const originalUser = prisma.user;
  const originalAccount = prisma.account;
  const originalTransaction = prisma.$transaction;
  const admin = { admin: "test" };
  let revocations = 0;
  let failRevocation = false;
  prisma.user = {
    async findUnique({ select }) {
      const user = database.user.find((user) => user.id === workerId);
      return select ? Object.fromEntries(Object.entries(user).filter(([key]) => select[key])) : user;
    },
    async findMany({ select }) {
      assert.equal(select.pin, undefined);
      return database.user.map(({ pin, ...user }) => user);
    },
  };
  prisma.account = {
    async findFirst() { return database.account.find((account) => account.userId === workerId); },
  };
  prisma.$transaction = async (fn) => {
    // Transactional in-memory substitute for the Prisma database used by routes.
    const snapshot = structuredClone(database);
    try {
      return await fn({
        user: {
          async update({ data, select }) {
            assert.equal(select?.pin, undefined);
            const updated = await ctx.internalAdapter.updateUser(workerId, data);
            const { pin, ...safeUser } = updated;
            return safeUser;
          },
        },
        account: {
          async update({ where, data }) {
            Object.assign(database.account.find((account) => account.id === where.id), data);
          },
        },
        session: {
          async deleteMany({ where }) {
            assert.equal(where.userId, workerId);
            if (failRevocation) throw new Error("Simulated revocation failure");
            revocations++;
            await ctx.internalAdapter.deleteUserSessions(workerId);
          },
        },
      });
    } catch (error) {
      for (const key of Object.keys(database)) database[key] = snapshot[key];
      throw error;
    }
  };
  try {
    const update = await userRequest("PUT", `/${workerId}`, { isActive: false }, admin);
    assert.equal(update.status, 200);
    assert.equal(database.user[0].isActive, false);
    assert.equal(database.session.length, 0);
    for (const cookie of cookies) {
      assert.equal((await userRequest("GET", "/", undefined, { cookie })).status, 401);
    }
    const blockedLogin = await post(instance, "sign-in/email", {
      email: "lifecycle@example.com", password: "original-password",
    });
    assert.equal(blockedLogin.status, 403);
    assert.equal(database.session.length, 0);

    await userRequest("PUT", `/${workerId}`, { isActive: true }, admin);
    for (let i = 0; i < 2; i++) {
      assert.equal((await post(instance, "sign-in/email", {
        email: "lifecycle@example.com", password: "original-password",
      })).status, 200);
    }
    assert.equal(database.session.length, 2);
    const reset = await userRequest("PUT", `/${workerId}/password`, { password: "replacement-password" }, admin);
    assert.equal(reset.status, 200);
    assert.equal(database.session.length, 0);
    assert.equal(revocations, 2);
    assert.equal((await post(instance, "sign-in/email", {
      email: "lifecycle@example.com", password: "original-password",
    })).status, 401);
    assert.equal((await post(instance, "sign-in/email", {
      email: "lifecycle@example.com", password: "replacement-password",
    })).status, 200);

    const pinUpdate = await userRequest("PUT", `/${workerId}`, { pin: "1234" }, admin);
    assert.equal(pinUpdate.status, 200);
    assert.equal(Object.hasOwn(pinUpdate.data.user, "pin"), false);
    assert.notEqual(database.user[0].pin, "1234");
    assert.equal(await verifyPassword({ hash: database.user[0].pin, password: "1234" }), true);
    const storedPin = database.user[0].pin;
    await userRequest("PUT", `/${workerId}`, { name: "Renamed Worker" }, admin);
    assert.equal(database.user[0].pin, storedPin);
    const listing = await userRequest("GET", "/", undefined, admin);
    assert.equal(listing.status, 200);
    assert.equal(Object.hasOwn(listing.data.users[0], "pin"), false);
    const detail = await userRequest("GET", `/${workerId}`, undefined, admin);
    assert.equal(detail.status, 200);
    assert.equal(Object.hasOwn(detail.data.user, "pin"), false);
    const session = await instance.api.getSession({ headers: { cookie: (await post(instance, "sign-in/email", {
      email: "lifecycle@example.com", password: "replacement-password",
    })).headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") } });
    assert.ok(session);
    assert.equal(Object.hasOwn(session.user, "pin"), false);

    failRevocation = true;
    const logMock = mock.method(console, "error", () => {});
    try {
      const failed = await userRequest("PUT", `/${workerId}/password`, { password: "must-not-be-saved" }, admin);
      assert.equal(failed.status, 500);
      assert.equal(await verifyPassword({ hash: database.account[0].password, password: "replacement-password" }), true);
      const sessionsBeforeFailure = database.session.length;
      const failedDeactivation = await userRequest("PUT", `/${workerId}`, { isActive: false }, admin);
      assert.equal(failedDeactivation.status, 500);
      assert.equal(database.user[0].isActive, true);
      assert.equal(database.session.length, sessionsBeforeFailure);
    } finally {
      logMock.mock.restore();
    }
  } finally {
    sessionMock.mock.restore();
    prisma.user = originalUser;
    prisma.account = originalAccount;
    prisma.$transaction = originalTransaction;
  }
});
