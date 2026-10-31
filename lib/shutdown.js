// Drain HTTP requests before closing the shared auth/business database pool.
export function installGracefulShutdown(server, db, {
  processRef = process, timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS || 30000),
  onShutdown = () => {}, logger = console,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid SHUTDOWN_TIMEOUT_MS.");
  let stopping = false, finished = false;
  const responses = new Set();
  server.on?.("request", (_req, res) => {
    responses.add(res);
    res.once("close", () => responses.delete(res));
    res.once("finish", () => {
      responses.delete(res);
      // A previously busy keep-alive socket can become idle after close() was
      // called. Reap it after Node finishes its response bookkeeping.
      if (stopping) setImmediate(() => server.closeIdleConnections?.());
    });
  });
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      processRef.exit(code);
    };
    const deadline = setTimeout(() => {
      logger.error("Graceful shutdown deadline exceeded; forcing exit.");
      server.closeAllConnections?.();
      finish(1);
    }, timeoutMs);
    let cleanupFailed = false;
    let backgroundStopped = Promise.resolve();
    try { backgroundStopped = Promise.resolve(onShutdown()).catch(() => {
      cleanupFailed = true;
      logger.error("Background shutdown failed.");
    }); } catch {
      cleanupFailed = true;
      logger.error("Background shutdown failed.");
    }
    for (const res of responses) {
      if (!res.headersSent) res.setHeader("Connection", "close");
    }
    server.close(async (error) => {
      if (finished) return;
      try {
        await backgroundStopped;
        if (finished) return;
        await db.$disconnect();
        finish(error || cleanupFailed ? 1 : 0);
      } catch {
        logger.error("Database shutdown failed.");
        finish(1);
      }
    });
    server.closeIdleConnections?.();
  };
  // Keep listeners installed: a second identical signal must not trigger the
  // process default exit and interrupt a transaction that is still draining.
  processRef.on("SIGTERM", shutdown);
  processRef.on("SIGINT", shutdown);
  return { isStopping: () => stopping, shutdown };
}
