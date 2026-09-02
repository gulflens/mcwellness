import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { MeResponse } from './_middleware/actor-schema';
import { mountTimeline } from './audit/timeline';
import { mountClients } from './clients/list';
import { mountDevSession, type DevSessionOptions } from './dev-session';
import {
  withRequestContext,
  type ApiEnv,
  type RequestContextDeps,
} from './_middleware/request-context';

/**
 * Builds the API. Kept separate from the server entry so tests can call
 * `createApi(deps).request(...)` in-process. Everything under /api except the
 * health check runs behind the request-context middleware: one transaction,
 * fenced to the API role, stamped with who is acting and why.
 */
export type ApiOptions = RequestContextDeps & {
  /** The development sign-in door. Only the server decides to pass this, and only on a laptop. */
  devSession?: DevSessionOptions;
  now?: () => Date;
};

export function createApi(deps: ApiOptions): Hono<ApiEnv> {
  const api = new Hono<ApiEnv>();

  api.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    // A database message can carry row values; only the shape of the failure is logged.
    const requestId = c.get('requestId') ?? c.res.headers.get('X-Request-Id') ?? null;
    console.error(
      JSON.stringify({ requestId, name: error.name, code: (error as { code?: string }).code }),
    );
    return c.json({ error: 'internal', requestId }, 500);
  });

  // Public, registered before the middleware. The payload carries nothing
  // environment-specific on purpose.
  api.get('/api/health', (c) => c.json({ ok: true, service: 'mcwellness-api' }));
  if (deps.devSession) {
    mountDevSession(api, deps.devSession);
  }

  api.use('/api/*', withRequestContext(deps));

  api.get('/api/me', async (c) => {
    const actor = c.get('actor');
    // The person's own row, read as themselves under row security.
    const { rows } = await c
      .get('db')
      .query<{ display_name: string }>('select display_name from app_user where id = $1', [
        actor.userId,
      ]);
    return c.json(
      MeResponse.parse({
        userId: actor.userId,
        displayName: rows[0]?.display_name ?? '',
        tenantId: actor.tenantId,
        roles: actor.roles,
        capabilities: actor.capabilities,
      }),
    );
  });

  mountClients(api, deps.now);
  mountTimeline(api, deps.now);

  return api;
}
