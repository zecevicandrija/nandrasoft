export type PendingSubmission = { key: string; url: string; payload: unknown };
export type SubmissionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const submissionKey = (userId: string, scope: string) => `nandra:submission:v1:${userId}:${scope}`;

export function readStored<T>(storage: SubmissionStorage, key: string): T | null {
  const value = storage.getItem(key);
  return value ? JSON.parse(value) as T : null;
}

export async function sendDurably(
  storage: SubmissionStorage, key: string, url: string, payload: unknown,
  fetcher: typeof fetch = fetch,
) {
  const previous = readStored<PendingSubmission>(storage, key);
  if (previous && (previous.url !== url || JSON.stringify(previous.payload) !== JSON.stringify(payload))) {
    throw new Error('Prethodno slanje još nije potvrđeno. Koristite „Ponovi prethodno slanje“ pre slanja izmenjenih podataka.');
  }
  const pending = previous || { key: crypto.randomUUID(), url, payload };
  // Persist before sending: a refresh or a lost response must retain the same key.
  storage.setItem(key, JSON.stringify(pending));
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
      body: JSON.stringify(pending.payload),
    });
  } catch {
    throw new Error('Slanje nije potvrđeno. Podaci su sačuvani na ovom uređaju. Proverite vezu i ponovite prethodno slanje.');
  }
  // An unreadable response is ambiguous too: retain the request for replay.
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Odgovor servera nije potvrđen. Ponovite prethodno slanje.'); }
  if (!response.ok) {
    // These application errors have no committed business writes. Keep the draft,
    // but permit a corrected payload to receive a new key.
    if ([400, 404, 409, 422].includes(response.status) && data.code !== 'IDEMPOTENCY_MISMATCH') storage.removeItem(key);
    throw new Error(data.error || 'Slanje nije potvrđeno. Ponovite prethodno slanje.');
  }
  return data;
}
