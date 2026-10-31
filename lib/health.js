const probeTimeout = () => Object.assign(new Error("Health probe timed out"), { code: "HEALTH_TIMEOUT" });
const isTimeout = (error) => ["HEALTH_TIMEOUT", "P2028", "57014"].includes(error?.code)
  || error?.meta?.code === "57014" || /timeout|timed out|expired/i.test(error?.message || "");

export async function runDatabaseProbe(db, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return db.$transaction(async (tx) => {
    const remaining = deadline - Date.now();
    // Never execute SELECT 1 if pool acquisition already exhausted the budget.
    if (remaining <= 0) throw probeTimeout();
    // PostgreSQL actually cancels the running statement. A JS Promise.race or
    // pg query_timeout alone would leave it executing on the server.
    await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(remaining)}, true)`;
    if (Date.now() >= deadline) throw probeTimeout();
    await tx.$queryRaw`SELECT 1`;
  }, { maxWait: timeoutMs, timeout: timeoutMs });
}

export function createHealthCheck(db, { isStopping = () => false, timeoutMs = 2000 } = {}) {
  let probe;
  // Share an unfinished probe so timeouts/polling never queue unlimited DB work.
  const checkDatabase = () => {
    if (!probe) {
      probe = Promise.resolve().then(() => runDatabaseProbe(db, { timeoutMs })).then(
        () => "up", (error) => isTimeout(error) ? "timeout" : "down"
      ).finally(() => { probe = undefined; });
    }
    return probe;
  };
  return async (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (isStopping()) {
      return res.status(503).json({ status: "shutting_down", timestamp: new Date().toISOString() });
    }
    let timer;
    try {
      const database = await Promise.race([
        checkDatabase(),
        new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); }),
      ]);
      const stopping = isStopping();
      res.status(database === "up" && !stopping ? 200 : 503).json({
        status: stopping ? "shutting_down" : database === "up" ? "ok" : "unavailable",
        database, timestamp: new Date().toISOString(),
      });
    } finally { clearTimeout(timer); }
  };
}

export function rejectWhileDraining(isStopping) {
  return (_req, res, next) => {
    if (!isStopping()) return next();
    res.set("Connection", "close");
    res.set("Cache-Control", "no-store");
    return res.status(503).json({ error: "Server se gasi. Pokušajte ponovo.", status: "shutting_down" });
  };
}
