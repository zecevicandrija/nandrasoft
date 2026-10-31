import {
  init, globalHandlersIntegration, browserApiErrorsIntegration,
  inboundFiltersIntegration, dedupeIntegration, captureReactException,
} from '@sentry/react';
import { sanitizeSentryEvent } from './sentryPolicy';

export function initializeSentryClient() {
  init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: 'production',
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    // No replay, tracing, HTTP instrumentation, console capture or breadcrumbs.
    defaultIntegrations: false,
    integrations: [
      globalHandlersIntegration(), browserApiErrorsIntegration(),
      inboundFiltersIntegration(), dedupeIntegration(),
    ],
    enableLogs: false,
    enableMetrics: false,
    maxBreadcrumbs: 0,
    beforeSend: sanitizeSentryEvent,
  });
}

export { captureReactException };
