import { Hono } from 'hono';

/**
 * Builds the API. Kept separate from the server entry so tests can call
 * `createApi().request(...)` in-process, with no socket and no database.
 */
export function createApi(): Hono {
  const api = new Hono();

  // Seam for PR 3: the audit session-context middleware is registered here,
  // before any route that touches the database, so that every request stamps
  // app.actor_id, app.request_id and app.reason with set_config(..., true).
  // See docs/SPEC/audit.md section 5.
  // api.use('/api/*', auditContext());

  // The health payload carries nothing environment-specific on purpose.
  api.get('/api/health', (c) => c.json({ ok: true, service: 'mcwellness-api' }));

  return api;
}
