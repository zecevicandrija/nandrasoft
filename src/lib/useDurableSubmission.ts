import { useEffect, useMemo, useRef, useState } from 'react';
import { readStored, sendDurably, submissionKey, type PendingSubmission } from './durableSubmission';

export function useDurableSubmission<T>(scope: string, userId: string | undefined, values: T, restore: (draft: T) => void) {
  const key = userId ? submissionKey(userId, scope) : null;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const [ready, setReady] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSubmission | null>(null);
  const [storageError, setStorageError] = useState('');
  const stopped = useRef(false);
  const initial = useRef(values);
  const previousKey = useRef<string | null>(null);
  const snapshot = JSON.stringify(values);
  const saved = useMemo(() => {
    if (!key) return null;
    try { return readStored<T>(localStorage, `${key}:draft`); } catch { return null; }
  }, [key]);
  useEffect(() => {
    stopped.current = false;
    if (!key) { setReady(null); setPending(null); restoreRef.current(initial.current); return; }
    try {
      if (saved) restoreRef.current(saved);
      else if (previousKey.current && previousKey.current !== key) restoreRef.current(initial.current);
      previousKey.current = key;
      setPending(readStored<PendingSubmission>(localStorage, key));
      setReady(key);
    } catch { setStorageError('Pregledač ne može da učita sačuvani unos.'); }
  }, [key, saved]);
  useEffect(() => {
    if (!key || ready !== key || stopped.current || snapshot === JSON.stringify(initial.current)) return;
    try { localStorage.setItem(`${key}:draft`, snapshot); setStorageError(''); }
    catch { setStorageError('Unos nije sačuvan na uređaju. Proverite dozvolu i slobodan prostor pregledača.'); }
  }, [key, ready, snapshot]);
  const request = async (url: string, payload: unknown) => {
    if (!key || ready !== key) throw new Error('Sačekajte potvrdu prijavljenog naloga.');
    try {
      localStorage.setItem(`${key}:draft`, snapshot);
      return await sendDurably(localStorage, key, url, payload);
    } finally {
      try { setPending(readStored<PendingSubmission>(localStorage, key)); }
      catch { setStorageError('Pregledač ne može da sačuva zahtev. Omogućite lokalno čuvanje podataka.'); }
    }
  };
  const clear = () => {
    stopped.current = true;
    if (key) {
      // If cleanup fails, keeping the old key is safer than issuing a new request.
      try { localStorage.removeItem(`${key}:draft`); localStorage.removeItem(key); }
      catch { setStorageError('Potvrđen unos nije uklonjen iz lokalne memorije.'); }
    }
    setPending(null);
  };
  // Start saving again once a new form is opened/edited after success.
  const resume = () => { stopped.current = false; };
  return { request, clear, resume, pending, hasDraft: Boolean(saved), storageError };
}
