import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { ApiEnv } from './request-context';

/**
 * The one line the API writes when a request fails
 * (docs/SPEC/hosting.md section 7.3).
 *
 * CLAUDE.md rule 9 forbids error trackers and rule 5 forbids logging personal
 * data anywhere, so there is no Sentry, no agent and nothing in the bundle.
 * What there is instead is this: one structured line per unhandled error on
 * this process's own stderr, which the host retains where the operator can read
 * it. Between it, the audit trail and the uptime alert, an outage is noticed and
 * diagnosable without a single third party receiving a household's data.
 *
 * What the line carries: the request identifier, the route *pattern*, the
 * status, how long the request took, and the class of the failure.
 *
 * What it must never carry, and the test beside this file proves each absence:
 * the query string (a search term is typed by staff about a client), the body,
 * the path's own parameters, and the driver's or the database's message, which
 * can hold a row's values. Anything that touched personal data is already in the
 * audit trail, which is the record that matters.
 */

/** Set by the middleware below and read only by `errorLine`. */
export type Timing = { readonly startedAt: number };

/**
 * Outermost in the stack, so the duration covers the whole request including
 * the protective headers and the budgets. It reads no header and writes none.
 */
export const withRequestTiming = createMiddleware<ApiEnv>(async (c, next) => {
  c.set('startedAt', performance.now());
  await next();
});

/**
 * Builds the line. Separate from writing it so a test can read the shape
 * without reading stderr.
 *
 * `message` is passed only by the callers whose comment says why: the three
 * seams whose every message is written in this repository and names no key, no
 * coordinate and no person. Nothing else may pass it, and nothing does.
 */
export function errorLine(
  c: Context<ApiEnv>,
  error: unknown,
  status: number,
  message?: string,
): string {
  const shape = (error ?? {}) as { name?: string; code?: string };
  const startedAt = c.get('startedAt') as number | undefined;
  return JSON.stringify({
    requestId: c.get('requestId') ?? c.res.headers.get('X-Request-Id') ?? null,
    // The pattern the router matched — "/api/clients/:id", never the id — or
    // "/*" when nothing matched at all. Never c.req.url, which carries the
    // query string, and never c.req.path, which carries the parameters.
    route: c.req.routePath,
    status,
    // Whole milliseconds: a duration is for spotting a slow route, and a
    // fractional one is only noise in a log file.
    ms: startedAt === undefined ? null : Math.round(performance.now() - startedAt),
    name: shape.name ?? null,
    code: shape.code,
    ...(message === undefined ? {} : { message }),
  });
}

/** Writes the line. One call, one line, on stderr. */
export function logError(
  c: Context<ApiEnv>,
  error: unknown,
  status: number,
  message?: string,
): void {
  console.error(errorLine(c, error, status, message));
}
