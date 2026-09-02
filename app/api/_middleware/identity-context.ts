import { createMiddleware } from 'hono/factory';
import type { IdentityKeys } from '@domain/shared';
import type { ApiEnv } from './request-context';

/**
 * Publishes the Emirates ID keys (domain/shared/identity, identity-key.ts's
 * identityKeysFromEnv) onto the request context, the way withRequestContext
 * publishes the actor and the database: a route reads `c.get('identityKeys')`
 * rather than the environment itself. create-api.ts mounts this only when it
 * is given identityKeys, so a deployment that has not set IDENTITY_KEY yet
 * still starts everything else; a route that needs the keys is responsible
 * for refusing cleanly when it finds none.
 */
export function withIdentityKeys(keys: IdentityKeys) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    c.set('identityKeys', keys);
    await next();
  });
}
