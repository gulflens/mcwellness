import { createMiddleware } from 'hono/factory';
import { RoutingUnavailableError, type RoutingProvider } from '../../../../domain/shared/routing';
import type { ApiEnv } from '../request-context';
import { googleRouting } from './google';
import { straightLineRouting } from './straight-line';

export { googleRouting } from './google';
export { straightLineRouting } from './straight-line';

/** The practice's own zone. The one place the seam needs to know what "peak" means. */
export const PRACTICE_TIME_ZONE = 'Asia/Dubai';

/**
 * Which implementation of the routing seam this deployment runs
 * (docs/SEAMS.md, docs/SPEC/practitioner-phone.md section 5.1).
 * `ROUTING_PROVIDER=straight-line` is the deterministic fallback and the
 * default on a laptop and in the tests; `ROUTING_PROVIDER=google` is the real
 * one. Anywhere else the choice is explicit or the API refuses to start —
 * exactly as `STORAGE_PROVIDER` is, and for the same reason: a deployment that
 * silently fell back would show a practitioner a straight line labelled as
 * traffic-free arithmetic when the practice had paid for the real thing, and
 * nobody would notice for weeks.
 *
 * Nothing reaches the network at construction time, so a vendor that is down
 * or a key that is wrong cannot stop the API from starting.
 */
export function routingFromEnv(env: NodeJS.ProcessEnv): RoutingProvider {
  const chosen = env.ROUTING_PROVIDER?.trim();
  const laptop = env.APP_ENV === 'development' || env.APP_ENV === 'test';

  if (!chosen) {
    if (!laptop) {
      throw new Error(
        'ROUTING_PROVIDER is not set. Choose "google" or "straight-line" explicitly outside development.',
      );
    }
    return straightLineRouting({ timeZone: PRACTICE_TIME_ZONE });
  }
  if (chosen === 'straight-line') {
    return straightLineRouting({ timeZone: PRACTICE_TIME_ZONE });
  }
  if (chosen === 'google') {
    // Blank is absent: an empty value in a secret store is a variable somebody
    // meant to fill in.
    const apiKey = env.GOOGLE_MAPS_API_KEY?.trim() || undefined;
    if (!apiKey) {
      throw new Error('ROUTING_PROVIDER=google needs GOOGLE_MAPS_API_KEY (a server key).');
    }
    return googleRouting({
      apiKey,
      signingSecret: env.GOOGLE_MAPS_SIGNING_SECRET?.trim() || undefined,
      timeZone: PRACTICE_TIME_ZONE,
    });
  }
  throw new Error(`ROUTING_PROVIDER is "${chosen}"; it is "google" or "straight-line".`);
}

/**
 * Publishes the provider onto the request context, the way `withStorage` does.
 * A route reads `c.get('routing')` rather than the environment, and no route
 * has ever seen the key.
 */
export function withRouting(routing: RoutingProvider) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    c.set('routing', routing);
    await next();
  });
}

/** The refusal an unreachable vendor gets, in the shape every other one uses. */
export function isRoutingUnavailable(error: unknown): error is RoutingUnavailableError {
  return error instanceof RoutingUnavailableError;
}
