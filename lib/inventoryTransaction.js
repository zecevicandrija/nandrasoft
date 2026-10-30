import { prisma } from "./prisma.js";
import { mutationIdentity, findReceipt, saveReceipt } from "./mutationReceipt.js";

// Every stock-changing route in a domain must acquire the same database lock
// BEFORE its first read. This also protects balances computed from many rows
// (cistern supplies/entries, packaged quantities), across backend processes.
const LOCK_KEYS = { fertilizer: 1, fuel: 2, onion: 3, tolls: 4, machines: 5 };
const LOCK_NAMESPACE = 1312902724;

class AbortedResponse extends Error {
  constructor(response) { super("Inventory operation rejected"); this.response = response; }
}

function transactionClient(tx, afterCommit) {
  let client;
  client = new Proxy(tx, {
    get(target, property) {
      if (property === "$afterCommit") return (callback) => { afterCommit.push(callback); };
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

export function inventoryMutation(domain, handler) {
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
      const identity = domain === "machines" && req.method === "POST" ? mutationIdentity(req) : null;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::integer, ${LOCK_KEYS[domain]}::integer)`;
        if (identity) {
          const receipt = await findReceipt(tx, identity);
          if (receipt) {
            response = receipt;
            return;
          }
        }
        await handler(req, pending, transactionClient(tx, afterCommit));
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
          body: { error: conflict
            ? "Stanje se trenutno menja. Osvežite podatke i pokušajte ponovo."
            : "Izmena stanja nije sačuvana. Pokušajte ponovo." },
        };
      }
    }
    if (response.status < 400) await Promise.allSettled(afterCommit.map((callback) => Promise.resolve().then(callback)));
    return res.status(response.status).json(response.body);
  };
}
