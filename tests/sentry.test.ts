import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeSentryEvent } from '../src/lib/sentryPolicy.ts';

test('frontend reports strip query tokens, user identity, payloads and breadcrumbs', () => {
  const event = sanitizeSentryEvent({
    request: { url: 'https://app.example.com/dashboard?token=secret#secret', headers: { Cookie: 'secret' }, data: 'secret' },
    user: { email: 'secret@example.com' }, extra: { form: 'secret' },
    contexts: { form: { value: 'secret' } }, breadcrumbs: [{ message: 'secret' }],
    exception: { values: [{ type: 'Error', value: 'render failed', stacktrace: { frames: [] } }] },
  });
  assert.deepEqual(event.request, { url: 'https://app.example.com/dashboard' });
  assert.doesNotMatch(JSON.stringify(event), /secret/);
  assert.ok(event.exception?.values?.[0].stacktrace);
});
