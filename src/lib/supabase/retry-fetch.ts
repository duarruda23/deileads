/**
 * fetch wrapper for the server-side service-role Supabase clients.
 *
 * Vercel functions intermittently lose the socket to Supabase
 * ("fetch failed" caused by ECONNRESET before the TLS handshake,
 * "other side closed", write ETIMEDOUT) — usually a pooled keep-alive
 * connection that the other side already dropped. A single retry on a
 * fresh socket almost always succeeds.
 *
 * Only network errors are retried, never HTTP error responses. Reads
 * (GET/HEAD) are always safe to repeat; writes are retried only when
 * the connection died before the TLS handshake finished, i.e. the
 * request provably never reached Supabase — anything else could have
 * been applied already, and repeating an insert would duplicate it.
 */

const RETRY_DELAYS_MS = [200, 600];

function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  let cur: unknown = err;
  while (cur && chain.length < 5) {
    chain.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return chain;
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch failed/i.test(err.message);
}

/** The request never left: the socket closed during the TLS handshake. */
export function failedBeforeSend(err: unknown): boolean {
  return errorChain(err).some((e) => {
    const msg = (e as { message?: unknown })?.message;
    return (
      typeof msg === 'string' &&
      /before secure TLS connection was established/i.test(msg)
    );
  });
}

export function isRetryable(err: unknown, method: string): boolean {
  if (!isNetworkError(err)) return false;
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return true;
  return failedBeforeSend(err);
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.method;
  }
  return 'GET';
}

export function createRetryFetch(
  baseFetch: typeof fetch = fetch,
  delays: number[] = RETRY_DELAYS_MS,
): typeof fetch {
  return async (input, init) => {
    const method = methodOf(input, init);
    for (let attempt = 0; ; attempt++) {
      try {
        return await baseFetch(input, init);
      } catch (err) {
        if (attempt >= delays.length || !isRetryable(err, method)) throw err;
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  };
}

export const retryFetch = createRetryFetch();
