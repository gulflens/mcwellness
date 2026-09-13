import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REFERENCE_TTL,
  forgetReferences,
  readReference,
  referenceCount,
  setReferenceClock,
} from './referenceCache';

function answering(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  forgetReferences();
  setReferenceClock(() => Date.now());
});

describe('readReference', () => {
  it('asks once and answers every later reader from memory', async () => {
    const fetchImpl = answering({ serviceTypes: [] });
    const first = await readReference(fetchImpl, '/api/billing/service-types');
    const second = await readReference(fetchImpl, '/api/billing/service-types');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ ok: true, status: 200, body: { serviceTypes: [] } });
    expect(second).toBe(first);
  });

  it('shares one request between two readers asking at the same moment', async () => {
    // Two drawers, or one drawer's two effects, opening together: one round
    // trip, not two.
    const fetchImpl = answering({ categories: [] });
    await Promise.all([
      readReference(fetchImpl, '/api/clients/goal-categories'),
      readReference(fetchImpl, '/api/clients/goal-categories'),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keys by the whole address, so a VAT rate for one date is not another', async () => {
    const fetchImpl = answering({ rate: 500 });
    await readReference(fetchImpl, '/api/billing/vat-rate?date=2026-09-01');
    await readReference(fetchImpl, '/api/billing/vat-rate?date=2026-10-01');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(referenceCount()).toBe(2);
  });

  it('asks again once the window has passed', async () => {
    let clock = 1_000_000;
    setReferenceClock(() => clock);
    const fetchImpl = answering({ serviceTypes: [] });
    await readReference(fetchImpl, '/api/billing/service-types');
    clock += REFERENCE_TTL + 1;
    await readReference(fetchImpl, '/api/billing/service-types');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failure', async () => {
    const fetchImpl = answering({ error: 'unavailable' }, 503);
    const failed = await readReference(fetchImpl, '/api/billing/service-types');
    expect(failed).toEqual({ ok: false, status: 503 });
    await readReference(fetchImpl, '/api/billing/service-types');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not remember a request that threw', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(readReference(fetchImpl, '/api/kit/options')).rejects.toThrow('offline');
    expect(referenceCount()).toBe(0);
  });

  it('forgets everything on demand, which is what a write and a sign-out do', async () => {
    const fetchImpl = answering({ serviceTypes: [] });
    await readReference(fetchImpl, '/api/billing/service-types');
    forgetReferences();
    await readReference(fetchImpl, '/api/billing/service-types');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps one session's answers apart from another's", async () => {
    // A second sign-in on the same device gets a fresh apiFetch, and with it
    // an empty cache. The same shape keeps one test case's answers out of
    // the next.
    const first = answering({ serviceTypes: ['first'] });
    const second = answering({ serviceTypes: ['second'] });
    const a = await readReference(first, '/api/billing/service-types');
    const b = await readReference(second, '/api/billing/service-types');
    expect(a).toMatchObject({ body: { serviceTypes: ['first'] } });
    expect(b).toMatchObject({ body: { serviceTypes: ['second'] } });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
