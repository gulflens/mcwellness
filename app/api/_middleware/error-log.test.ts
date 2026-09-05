import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../create-api';
import type { PoolLike } from './request-context';
import type { TokenVerifier } from './token-verifier';

/**
 * The error line (docs/SPEC/hosting.md section 7.3), proved through a real
 * route that throws rather than by calling the builder directly: what reaches
 * stderr is what this file asserts, and every absence it asserts is one that
 * would otherwise put a client's data in a log file the practice does not own.
 */

const untouchedPool: PoolLike = {
  async connect() {
    throw new Error('the pool must not be touched');
  },
};
const rejectingVerifier: TokenVerifier = {
  async verify() {
    return null;
  },
};

// A message of the sort a driver or a query writes: it carries a search term, a
// person's name and a telephone number, exactly the things that must not travel.
const LEAKY = 'relation "client" row (Hazel Lagoon, +971500000001) violates something';

function apiThatThrows(): ReturnType<typeof createApi> {
  const api = createApi({ pool: untouchedPool, verifier: rejectingVerifier });
  // Registered after createApi has built the stack, so this route sits below
  // the protective headers and the timing middleware and above nothing: a
  // throw from it reaches the same onError every route's throw reaches.
  api.get('/probe/:token/thing', () => {
    const error = new TypeError(LEAKY);
    (error as { code?: string }).code = '23503';
    throw error;
  });
  return api;
}

async function lineFrom(path: string): Promise<Record<string, unknown>> {
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await apiThatThrows().request(path);
    expect(response.status).toBe(500);
    expect(stderr).toHaveBeenCalledTimes(1);
    return JSON.parse(String(stderr.mock.calls[0]?.[0])) as Record<string, unknown>;
  } finally {
    stderr.mockRestore();
  }
}

describe('the line written when a request fails', () => {
  it('carries the route pattern, the status, a duration and the error class', async () => {
    const line = await lineFrom('/probe/abc/thing?q=Hazel');

    expect(line.route).toBe('/probe/:token/thing');
    expect(line.status).toBe(500);
    expect(line.name).toBe('TypeError');
    expect(line.code).toBe('23503');
    expect(typeof line.ms).toBe('number');
    expect(line.ms as number).toBeGreaterThanOrEqual(0);
    // Whole milliseconds; a fraction is noise in a log file.
    expect(Number.isInteger(line.ms)).toBe(true);
  });

  it('carries no query string, no path parameter and no error message', async () => {
    const raw = JSON.stringify(
      await lineFrom(
        '/probe/00000008-0000-4000-8000-000000000001/thing?q=Hazel&phone=%2B971500000001',
      ),
    );

    // The search term staff typed about a client.
    expect(raw).not.toContain('Hazel');
    expect(raw).not.toContain('q=');
    // The identifier in the path: the pattern is logged, never the value.
    expect(raw).not.toContain('00000008-0000-4000-8000-000000000001');
    // The telephone number, and the driver's whole sentence with it.
    expect(raw).not.toContain('971500000001');
    expect(raw).not.toContain('violates something');
    expect(raw).not.toContain(LEAKY);
  });

  it('is one line per failure and not several', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = apiThatThrows();

    await api.request('/probe/one/thing');
    await api.request('/probe/two/thing');

    expect(stderr).toHaveBeenCalledTimes(2);
    stderr.mockRestore();
  });

  it('says nothing at all when a request succeeds', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await apiThatThrows().request('/api/health')).status).toBe(200);

    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
  });
});
