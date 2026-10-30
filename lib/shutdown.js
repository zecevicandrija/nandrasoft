// Drain HTTP requests before closing the shared auth/business database pool.
export function installGracefulShutdown(server, db, { processRef = process, timeoutMs = 30000 } = {}) {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => processRef.exit(1), timeoutMs);
    deadline.unref();
    server.close(async () => {
      try {
        await db.$disconnect();
        clearTimeout(deadline);
        processRef.exit(0);
      } catch {
        console.error("Database shutdown failed.");
        clearTimeout(deadline);
        processRef.exit(1);
      }
    });
  };
  processRef.once("SIGTERM", shutdown);
  processRef.once("SIGINT", shutdown);
}
