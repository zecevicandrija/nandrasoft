# Sentry error monitoring

Organization: `zecevic-dev`. Runtime integration is implemented. The supplied React
DSN (project `4512351917113424`) is configured and enabled for local production
builds in the ignored `frontend/.env.production.local` file. Development stays
disabled. Remote CI/hosting must receive the same frontend environment variables
separately because this local file is not committed. The supplied Node/Express
DSN (project `4512351930941520`) and `SENTRY_ENABLED=true` are configured in the
ignored `backend/.env` file. `NODE_ENV` was not changed: backend reporting still
requires `NODE_ENV=production`, so ordinary local development remains disabled.
Remote backend hosting must receive the same DSN/flag and production environment.
No production deployment or live Sentry smoke event has been performed.

## Activation

Create/select two Sentry projects in the organization: Node/Express for the backend
and React for the frontend. Copy each project's DSN from Settings → Projects →
Client Keys (DSN). A run/onboarding code is not a project DSN.

Merge the following variables into the production backend environment (do not
replace the existing environment or database credentials):

```dotenv
NODE_ENV=production
SENTRY_ENABLED=true
SENTRY_DSN=<backend project DSN>
SENTRY_RELEASE=<deployed commit or version>
```

Set the frontend variables in the production build environment, then rebuild:

```dotenv
VITE_SENTRY_ENABLED=true
VITE_SENTRY_DSN=<frontend project DSN>
VITE_SENTRY_RELEASE=<same deployed commit or version>
```

Backend restart is required after changing its variables; frontend variables are
baked in at build time. Examples are in `backend/.env.sentry.example` and
`frontend/.env.sentry.example`. Never put auth tokens in `VITE_*` variables.
Only public ingestion DSNs belong there.

## Behavior and scope

- Local development is disabled even with the opt-in flag. Missing DSNs/flags
  leave the SDK inactive.
- Backend captures `Error` objects passed to existing `console.error` calls,
  including errors caught inside routes and background work. Plain console text
  is ignored; existing console output remains unchanged.
- Forwarded Express errors with status >=500 are captured before continuing
  through the existing error handling. Errors explicitly marked 4xx are dropped.
  Expected business failures without an exception are not inferred from responses.
- Backend uncaught exceptions and unhandled rejections are reported. Unhandled
  rejections use strict mode to retain Node's fatal failure behavior.
- Frontend captures global JS errors and unhandled promises after the optional SDK
  chunk loads, plus React errors caught by the existing AppErrorBoundary.
  React error reports wait for initialization; application rendering does not.
  A blocked SDK chunk cannot stop rendering. Global errors before the SDK loads
  can be missed.
- No session replay, profiling, tracing integrations, application logs, metrics,
  HTTP/fetch/database instrumentation, or ESM loader hooks are enabled.
- Request payloads, user identity, extras, breadcrumbs and contexts are removed.
  Backend sends only method and route template as request context. Frontend keeps
  page origin/path, removing headers, body, query and fragment. Prisma/pg error
  messages are replaced with generic descriptions while retaining stack frames.
  Other exception messages are retained for diagnosis: do not include sensitive
  values in custom Error messages. This policy is not a universal PII scrubber.
- Reporting does not await network delivery in request handlers. Backend transport
  has a 20-item buffer, 2s timeout and best-effort 2s shutdown flush.
- Frontend source-map upload is not configured: production frontend stack frames
  may reference minified files. Add private source-map upload in deployment CI
  once the project and CI secret storage are available; do not publish maps with
  sources or expose auth tokens in the application.

## Free-plan operation and alerts

Keep the organization on Developer/free after any trial. Check its actual quotas
in Settings → Subscription/Usage. Repeated occurrences consume event quota even
when grouped into a single issue; disabling tracing/replay does not cap errors.
No paid upgrade or billing settings have been changed.

Collection and email notifications are separate. In Sentry configure alerts for
production issues that need attention (for example new issues, regressions or a
high event count). Alert rules have not been changed from this workspace.

## Verification and rollback

```text
backend:  npm run test:sentry
backend:  node --test tests/server-lifecycle.test.js
frontend: npm run test:sentry
frontend: npm run build
frontend: node --test tests/bundle-splitting.test.ts
```

Backend integration tests use a local HTTP ingestion server, not the real account.
They verify actual Sentry envelopes, route isolation under concurrent requests,
caught and forwarded errors, unchanged responses, privacy filtering, disabled
mode and unreachable ingestion. Frontend tests check payload filtering and build
dependency boundaries. Database-backed lifecycle smoke testing requires its
existing explicit opt-in and is skipped otherwise.

After activating real DSNs, verify one controlled staging/manual event per
project and confirm the environment and release in Sentry. Do not add a public
crash endpoint or intentionally fail a live business operation.

To disable: set backend `SENTRY_ENABLED=false` and restart; set frontend
`VITE_SENTRY_ENABLED=false` and rebuild/redeploy. No data migrations are involved.

The requested `@sentry/agent-plugin` installer installed the Codex and Claude Code
plugins it detected. It requires restarting those agents before their Sentry tools
become available; plugin installation alone does not configure application DSNs.
