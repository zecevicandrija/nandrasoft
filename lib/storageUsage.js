export function storageThreshold(bytes, quota) {
  if (!Number.isSafeInteger(quota) || quota <= 0) throw new Error("Neispravna kvota baze.");
  return bytes >= quota * 0.9 ? "critical" : bytes >= quota * 0.8 ? "warning" : "ok";
}

export async function readStorageUsage(db, env = process.env) {
  const quotaBytes = Number(env.DB_STORAGE_QUOTA_BYTES || 6_000_000_000);
  storageThreshold(0, quotaBytes);
  const [row] = await db.$queryRaw`SELECT
    pg_database_size(current_database())::text AS "databaseBytes",
    pg_total_relation_size('audit_log'::regclass)::text AS "auditBytes",
    pg_total_relation_size('mutation_receipt'::regclass)::text AS "receiptBytes"`;
  const databaseBytes = Number(row.databaseBytes);
  return { databaseBytes, auditBytes: Number(row.auditBytes), receiptBytes: Number(row.receiptBytes), quotaBytes,
    usedPercent: Number((100 * databaseBytes / quotaBytes).toFixed(2)),
    level: storageThreshold(databaseBytes, quotaBytes), measuredAt: new Date().toISOString(),
    measurement: "PostgreSQL database size; provider quota may also include WAL or backups." };
}

export function startStorageMonitor(db, { intervalMs = 6 * 60 * 60 * 1000, logger = console } = {}) {
  let busy = false, stopped = false;
  const check = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const usage = await readStorageUsage(db);
      if (!stopped && usage.level !== "ok") logger.warn("DATABASE_STORAGE_ALERT", usage);
    } catch { if (!stopped) logger.error("DATABASE_STORAGE_MONITOR_UNAVAILABLE"); }
    finally { busy = false; }
  };
  const timer = setInterval(check, intervalMs);
  timer.unref?.();
  void check();
  return () => { stopped = true; clearInterval(timer); };
}
