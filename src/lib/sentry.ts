import type { ErrorInfo } from 'react';

let initialization: Promise<typeof import('./sentryClient') | undefined> | undefined;

export function initializeSentry() {
  if (!import.meta.env.PROD || import.meta.env.VITE_SENTRY_ENABLED !== 'true' || !import.meta.env.VITE_SENTRY_DSN) {
    return Promise.resolve(undefined);
  }
  initialization ??= import('./sentryClient').then((Sentry) => {
    Sentry.initializeSentryClient();
    return Sentry;
  }).catch(() => undefined);
  return initialization;
}

export function reportReactError(error: Error, info: ErrorInfo) {
  // A blocked/failed monitoring chunk must never block rendering or recovery.
  void initializeSentry().then((Sentry) => {
    Sentry?.captureReactException(error, info);
  }).catch(() => {});
}
