import { describe, expect, it } from 'vitest';
import { createApi } from './create-api';

describe('GET /api/health', () => {
  it('answers ok without a socket or a database', async () => {
    const response = await createApi().request('/api/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'mcwellness-api' });
  });

  it('does not answer routes that do not exist yet', async () => {
    const response = await createApi().request('/api/clients');

    expect(response.status).toBe(404);
  });
});
