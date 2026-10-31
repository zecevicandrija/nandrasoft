import "dotenv/config";
import { sanitizeSentryEvent } from "./sentryPolicy.js";

let sdk;
// No DSN or explicit production opt-in: no SDK initialization or network traffic.
if (process.env.SENTRY_ENABLED === "true" && process.env.NODE_ENV === "production" && process.env.SENTRY_DSN) {
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: "production",
      release: process.env.SENTRY_RELEASE || undefined,
      sendDefaultPii: false,
      defaultIntegrations: false,
      integrations: [
        Sentry.captureConsoleIntegration({ levels: ["error"] }),
        Sentry.dedupeIntegration(),
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration({ mode: "strict", ignore: [] }),
      ],
      // Error reporting only: do not patch Express, Prisma, pg or the ESM loader.
      registerEsmLoaderHooks: false,
      autoSessionTracking: false,
      enableLogs: false,
      enableMetrics: false,
      maxBreadcrumbs: 0,
      transportOptions: { bufferSize: 20, timeout: 2000 },
      beforeSend: sanitizeSentryEvent,
    });
    sdk = Sentry;
  } catch {
    console.warn("Sentry initialization failed; application will continue without reporting.");
  }
}

export function sentryRequestScope(req, _res, next) {
  if (!sdk) return next();
  sdk.withIsolationScope((scope) => {
    scope.setTag("http.method", req.method);
    scope.addEventProcessor((event) => {
      // Express route templates retain useful context without IDs or query strings.
      if (typeof req.route?.path === "string") event.transaction = `${req.method} ${req.baseUrl}${req.route.path}`;
      return event;
    });
    next();
  });
}

export function sentryErrorHandler(error, _req, _res, next) {
  const status = Number(error.status || error.statusCode || 500);
  if (sdk && status >= 500) {
    try { sdk.captureException(error); } catch { /* Reporting must not affect the response. */ }
  }
  next(error);
}

export async function flushSentry() {
  try { await sdk?.flush(2000); } catch { /* Best effort during graceful shutdown. */ }
}
