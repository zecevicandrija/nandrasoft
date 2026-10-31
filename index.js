import "dotenv/config";
import { sentryRequestScope, sentryErrorHandler, flushSentry } from "./lib/sentry.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { installApiAccess } from "./lib/rateLimiting.js";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./routes/auth.js";
import { prisma } from "./lib/prisma.js";
import { installGracefulShutdown } from "./lib/shutdown.js";
import { createHealthCheck, rejectWhileDraining } from "./lib/health.js";
import { startStorageMonitor } from "./lib/storageUsage.js";
import { startPushOutboxWorker } from "./lib/pushOutbox.js";
import { sendPushSubscription, isPushConfigured } from "./lib/pushNotification.js";
import usersRouter from "./routes/users.js";
import masterDataRouter from "./routes/masterData.js";
import assignmentsRouter from "./routes/assignments.js";
import fieldWorkRouter from "./routes/fieldWork.js";
import auditLogRouter from "./routes/auditLog.js";
import workOrdersRouter from "./routes/workOrders.js";
import fuelRouter from "./routes/fuel.js";
import maintenanceRouter from "./routes/maintenance.js";
import tollsRouter from "./routes/tolls.js";
import notificationsRouter from "./routes/notifications.js";
import fertilizerRouter from "./routes/fertilizer.js";
import seasonalWorkersRouter from "./routes/seasonalWorkers.js";
import onionRouter from "./routes/onion.js";
import analyticsRouter from "./routes/analytics.js";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(sentryRequestScope);

// Dozvoli rad iza proksija (ngrok, localtunnel, Cloudflare, Nginx)
app.set("trust proxy", 1);

// Sigurnosna HTTP zaglavlja (Helmet - štiti od XSS, clickjacking, MIME sniffing itd.)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// CORS - dozvoli frontend na localhost i preko tunela (ngrok, localtunnel)
app.use(
  cors({
    origin: (origin, callback) => {
      // Dozvoli ako nema origin-a (server-to-server, curl) ili ako je localhost / ngrok / localtunnel
      if (
        !origin ||
        origin.includes("localhost") ||
        origin.includes("ngrok") ||
        origin.includes("loca.lt")
      ) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  })
);

// Readiness must remain available independently of application rate limits.
app.get("/api/health", createHealthCheck(prisma, { isStopping: () => shutdown.isStopping() }));
app.use(rejectWhileDraining(() => shutdown.isStopping()));

installApiAccess(app, toNodeHandler(auth));

// JSON body parser za ostale rute
app.use(express.json());

// API rute
app.use("/api/users", usersRouter);
app.use("/api/master", masterDataRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/field-work", fieldWorkRouter);
app.use("/api/audit-logs", auditLogRouter);
app.use("/api/work-orders", workOrdersRouter);
app.use("/api/fuel", fuelRouter);
app.use("/api/maintenance", maintenanceRouter);
app.use("/api/tolls", tollsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/fertilizer", fertilizerRouter);
app.use("/api/seasonal", seasonalWorkersRouter);
app.use("/api/onion", onionRouter);
app.use("/api/analytics", analyticsRouter);

app.use(sentryErrorHandler);

const stopStorageMonitor = startStorageMonitor(prisma);
const stopPushWorker = startPushOutboxWorker(prisma, sendPushSubscription, { enabled: isPushConfigured() });
const server = app.listen(PORT, () => {
  console.log(`✅ NANDRA Backend pokrenut na http://localhost:${PORT}`);
});

const shutdown = installGracefulShutdown(server, prisma, { onShutdown: () => {
  stopStorageMonitor();
  return Promise.resolve(stopPushWorker()).finally(flushSentry);
} });
server.once("close", stopStorageMonitor);

export default app;

