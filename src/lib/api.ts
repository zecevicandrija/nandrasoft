const rawApiUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');

export const API_ORIGIN = rawApiUrl.endsWith('/api')
  ? rawApiUrl.slice(0, -4)
  : rawApiUrl;

export const API = `${API_ORIGIN}/api`;

export function resolveApiUrl(input: string): string {
  if (!API_ORIGIN) return input;
  if (input === '/api' || input.startsWith('/api/') || input.startsWith('/api?')) {
    return `${API_ORIGIN}${input}`;
  }
  return input;
}

let fetchPatched = false;

/**
 * When VITE_API_URL is configured (e.g. separate VPS backend behind Cloudflare Pages),
 * transparently routes relative `/api` fetch calls to `${API_ORIGIN}/api/...`.
 * In local dev (when VITE_API_URL is unset), this is a no-op so Vite's `/api` proxy handles requests.
 */
export function installApiBaseFetch(): void {
  if (fetchPatched || !API_ORIGIN || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return;
  }
  fetchPatched = true;
  const nativeFetch = window.fetch.bind(window);
  const patchedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === 'string') {
      return nativeFetch(resolveApiUrl(input), init);
    }
    if (input instanceof URL) {
      if (input.origin === window.location.origin && (input.pathname === '/api' || input.pathname.startsWith('/api/'))) {
        return nativeFetch(new URL(`${API_ORIGIN}${input.pathname}${input.search}`), init);
      }
      return nativeFetch(input, init);
    }
    if (input instanceof Request) {
      const url = new URL(input.url);
      if (url.origin === window.location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/'))) {
        const rewritten = `${API_ORIGIN}${url.pathname}${url.search}`;
        return nativeFetch(new Request(rewritten, input), init);
      }
    }
    return nativeFetch(input, init);
  };
  window.fetch = Object.assign(patchedFetch, window.fetch);
}
