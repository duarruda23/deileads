import { describe, expect, it, vi } from 'vitest';
import { createRetryFetch, isRetryable } from './retry-fetch';

function netError(causeMessage: string) {
  return new TypeError('fetch failed', { cause: new Error(causeMessage) });
}
const TLS_RESET =
  'Client network socket disconnected before secure TLS connection was established';
const CLOSED = 'other side closed';

describe('isRetryable', () => {
  it('retries any network error on reads', () => {
    expect(isRetryable(netError(CLOSED), 'GET')).toBe(true);
    expect(isRetryable(netError(TLS_RESET), 'HEAD')).toBe(true);
  });

  it('retries writes only when the request never left', () => {
    expect(isRetryable(netError(TLS_RESET), 'POST')).toBe(true);
    expect(isRetryable(netError(CLOSED), 'POST')).toBe(false);
    expect(isRetryable(netError('write ETIMEDOUT'), 'PATCH')).toBe(false);
  });

  it('never retries non-network errors', () => {
    expect(isRetryable(new Error('boom'), 'GET')).toBe(false);
  });
});

describe('createRetryFetch', () => {
  it('recovers from a transient read failure', async () => {
    const ok = new Response('[]');
    const base = vi
      .fn()
      .mockRejectedValueOnce(netError(CLOSED))
      .mockResolvedValueOnce(ok);
    const f = createRetryFetch(base as unknown as typeof fetch, [0, 0]);
    await expect(f('https://x/rest/v1/t')).resolves.toBe(ok);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('does not repeat an ambiguous write', async () => {
    const base = vi.fn().mockRejectedValue(netError(CLOSED));
    const f = createRetryFetch(base as unknown as typeof fetch, [0, 0]);
    await expect(f('https://x', { method: 'POST' })).rejects.toThrow('fetch failed');
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured retries', async () => {
    const base = vi.fn().mockRejectedValue(netError(TLS_RESET));
    const f = createRetryFetch(base as unknown as typeof fetch, [0, 0]);
    await expect(f('https://x', { method: 'POST' })).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(3);
  });
});
