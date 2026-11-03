import { prisma } from "./prisma.js";
import { mutationIdentity, findReceipt, saveReceipt } from "./mutationReceipt.js";
import { randomUUID } from "node:crypto";
import { nextMachineTimestamp } from "./machineFuel.js";

// Every stock-changing route in a domain must acquire the same database lock
// BEFORE its first read. This also protects balances computed from many rows
// (cistern supplies/entries, packaged quantities), across backend processes.
const LOCK_KEYS = { fertilizer: 1, fuel: 2, onion: 3, tolls: 4, machines: 5, seasonal: 6, workers: 7 };
const LOCK_NAMESPACE = 1312902724;

class AbortedResponse extends Error {
  constructor(response) { super("Inventory operation rejected"); this.response = response; }
}

function transactionClient(tx, afterCommit, onLockFailure) {
  let client;
  const lockedMachines = new Set();
  const delegates = new Map();
  const lockMachine = async (id) => {
    if (typeof id !== "string" || lockedMachines.has(id)) return;
    // The row lock is shared across fuel, assignment, field-work, order and
    // catalogue domains, including implicit PostgreSQL locks on other writers.
    try {
      await tx.$executeRaw`SELECT id FROM "machine" WHERE id = ${id} FOR UPDATE`;
    } catch (error) {
      // Preserve the original lock error even when a controller catches it
      // and otherwise converts a retryable conflict into a generic 500.
      onLockFailure(error);
      throw error;
    }
    lockedMachines.add(id);
  };
  client = new Proxy(tx, {
    get(target, property) {
      if (property === "$afterCommit") return (callback) => { afterCommit.push(callback); };
      if (["machine", "machineAssignment", "workOrder", "fuelEntry", "fieldWork"].includes(property)) {
        if (!delegates.has(property)) delegates.set(property, new Proxy(target[property], {
          get(model, operation) {
            const method = Reflect.get(model, operation, model);
            if (typeof method !== "function") return method;
            return async (args) => {
              if (property === "machine" && typeof args?.where?.id === "string") {
                await lockMachine(args.where.id);
                if (operation === "update") {
                  const previous = await model.findUnique({ where: { id: args.where.id }, select: { updatedAt: true } });
                  // Also advance metadata/status updates so a later status sync
                  // cannot move the form's version backwards within one ms.
                  args = { ...args, data: { ...args.data, updatedAt: nextMachineTimestamp(previous || {}) } };
                }
              } else if (["findUnique", "findFirst"].includes(operation) && (args?.include?.machine || args?.select?.machine)) {
                // Resolve only the foreign key first. Read the actual machine
                // snapshot after acquiring its lock, never return a stale join.
                const owner = await method.call(model, { where: args.where, select: { machineId: true } });
                if (owner?.machineId) await lockMachine(owner.machineId);
              }
              return method.call(model, args);
            };
          },
        }));
        return delegates.get(property);
      }
      // Existing controller transaction groups join the outer transaction;
      // they must never open another connection or commit independently.
      if (property === "$transaction") {
        return async (operations) => {
          if (typeof operations === "function") return operations(client);
          const results = [];
          for (const operation of operations) results.push(await operation);
          return results;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return client;
}

export function inventoryMutation(domain, handler, { idempotent = domain === "machines" } = {}) {
  if (!Object.hasOwn(LOCK_KEYS, domain)) throw new Error("Unknown inventory domain");
  return async (req, res) => {
    const afterCommit = [];
    let response = { status: 200, body: undefined };
    // Do not send a success response until the database has committed.
    const pending = {
      status(code) { response.status = code; return this; },
      json(body) { response.body = body; return this; },
    };
    try {
      const identity = idempotent && req.method === "POST" ? mutationIdentity(req) : null;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::integer, ${LOCK_KEYS[domain]}::integer)`;
        if (identity) {
          // A user/key is global across routes. Serialize it across domains too,
          // so simultaneous reuse on a different route returns a mismatch.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(1312902725::integer, hashtext(${JSON.stringify([identity.userId, identity.key])}))`;
          const receipt = await findReceipt(tx, identity);
          if (receipt) {
            response = receipt;
            return;
          }
        }
        req.auditOperationId = randomUUID();
        let lockFailure;
        await handler(req, pending, transactionClient(tx, afterCommit, (error) => { lockFailure = error; }));
        if (lockFailure) throw lockFailure;
        if (response.body === undefined) throw new Error("Inventory handler did not produce a response");
        // Controllers may catch errors themselves. A failure response must
        // still roll back every write performed earlier in this operation.
        if (response.status >= 400) throw new AbortedResponse(response);
        if (identity) await saveReceipt(tx, identity, response);
      }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
    } catch (error) {
      if (error instanceof AbortedResponse || error.response) {
        response = error.response;
      } else {
        const conflict = ["P2028", "P2034"].includes(error.code) ||
          ["55P03", "40P01"].includes(error.meta?.code);
        response = {
          status: conflict ? 409 : 500,
          body: { ...(conflict && { code: "INVENTORY_BUSY" }), error: conflict
            ? "Stanje se trenutno menja. Osvežite podatke i pokušajte ponovo."
            : "Izmena stanja nije sačuvana. Pokušajte ponovo." },
        };
      }
    }
    if (response.status < 400) await Promise.allSettled(afterCommit.map((callback) => Promise.resolve().then(callback)));
    return res.status(response.status).json(response.body);
  };
}
