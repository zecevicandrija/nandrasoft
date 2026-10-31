import type { ErrorEvent } from '@sentry/react';

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  delete event.contexts;
  // Only the page origin/path is useful; query strings can contain credentials.
  if (event.request?.url) {
    try {
      const url = new URL(event.request.url);
      event.request = { url: `${url.origin}${url.pathname}` };
    } catch {
      delete event.request;
    }
  } else {
    delete event.request;
  }
  return event;
}
