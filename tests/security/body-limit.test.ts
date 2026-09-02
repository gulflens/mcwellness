import { describe, expect, it } from 'vitest';
import { BODY_LIMIT_BYTES, createApi } from '../../app/api/create-api';

const deps = {
  pool: {
    connect: async () => {
      throw new Error('no database in this test');
    },
  },
  verifier: { verify: async () => null },
  keyOf: () => 'test',
  devSession: {
    secret: 'test-secret-that-unlocks-nothing-0123456789',
    issuer: 'http://localhost:54321/auth/v1',
  },
};

describe('request bodies', () => {
  it('refuses a body over the cap before anything reads it', async () => {
    const api = createApi(deps);
    const res = await api.request('/api/dev/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authId: 'x'.repeat(BODY_LIMIT_BYTES + 1024) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large', requestId: null });
  });

  it('refuses a body that is not JSON', async () => {
    const api = createApi(deps);
    const res = await api.request('/api/dev/session', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'authId=owner',
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'unsupported_media_type', requestId: null });
  });

  it('accepts a small JSON body', async () => {
    const api = createApi(deps);
    const res = await api.request('/api/dev/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authId: '00000003-0000-4000-8000-000000000001' }),
    });
    expect(res.status).toBe(200);
  });
});
