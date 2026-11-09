export function databasePoolConfig(env = process.env) {
  const rawMax = env.DB_POOL_MAX ?? "8";
  if (!/^[1-9]\d*$/.test(rawMax) || Number(rawMax) > 10) {
    throw new Error("DB_POOL_MAX must be an integer from 1 to 10. Budget all processes, including deployment overlap, against the database connection limit.");
  }
  return {
    connectionString: env.DATABASE_URL,
    // Prisma's pg adapter exchanges timezone-less UTC timestamps. Keep every
    // session in UTC so timestamptz reads and Date parameters preserve instants.
    options: "-c timezone=UTC",
    max: Number(rawMax),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    application_name: `nandra-backend-${process.pid}`,
  };
}
