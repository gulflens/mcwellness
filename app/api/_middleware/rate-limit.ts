import type { Context, MiddlewareHandler } from 'hono';
import { isIP } from 'node:net';
import { getConnInfo } from '@hono/node-server/conninfo';

/**
 * Rate limiting without a dependency: a sliding window of timestamps per key,
 * in this process's memory. Right for one API instance; several instances
 * need a shared store (docs/SECURITY.md). Budgets come from the environment.
 *
 * Two modes: 'request' counts every request before it runs; 'failure' counts
 * only 401 answers after they happen, so a caller guessing tokens is cut off
 * without every honest request from that address counting against them (once
 * the failure budget is spent, that address waits like any other).
 *
 * The map of keys is bounded: past MAX_KEYS a sweep runs at once and, if it is
 * still over, new keys are refused rather than stored (fail closed, memory
 * safe). Behind a proxy the forwarded address is accepted only when it is a
 * well-formed IP; anything else falls back to the socket's address.
 */

export type RateLimitOptions = {
  name: string;
  windowMs: number;
  max: number;
  /** The bucket a request belongs to; null means "do not limit this request". */
  keyOf: (c: Context) => string | null;
  mode?: 'request' | 'failure';
  now?: () => number;
};

export const MAX_KEYS = 50_000;

export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly max: number;

  constructor(windowMs: number, max: number) {
    this.windowMs = windowMs;
    this.max = max;
  }

  /** How many hits the key has inside the window ending now, after dropping old ones. */
  count(key: string, now: number): number {
    const stamps = this.hits.get(key);
    if (!stamps) return 0;
    const from = now - this.windowMs;
    while (stamps.length > 0 && (stamps[0] ?? 0) <= from) stamps.shift();
    if (stamps.length === 0) this.hits.delete(key);
    return stamps.length;
  }

  /** True when a new key cannot be stored because the map is full even after a sweep. */
  full(key: string, now: number): boolean {
    if (this.hits.has(key) || this.hits.size < MAX_KEYS) return false;
    this.sweep(now);
    return this.hits.size >= MAX_KEYS;
  }

  hit(key: string, now: number): number {
    const stamps = this.hits.get(key) ?? [];
    stamps.push(now);
    this.hits.set(key, stamps);
    return this.count(key, now);
  }

  /** Milliseconds until the oldest hit inside the window falls out. */
  retryAfterMs(key: string, now: number): number {
    const oldest = this.hits.get(key)?.[0];
    return oldest === undefined ? 0 : Math.max(0, oldest + this.windowMs - now);
  }

  isLimited(key: string, now: number): boolean {
    return this.count(key, now) >= this.max;
  }

  /** Drops every key with nothing left in its window; runs on request arrival, once per window. */
  sweep(now: number): number {
    let removed = 0;
    for (const key of [...this.hits.keys()]) {
      if (this.count(key, now) === 0) removed += 1;
    }
    return removed;
  }

  get size(): number {
    return this.hits.size;
  }
}

function tooMany(c: Context, options: RateLimitOptions, retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  c.header('Retry-After', String(seconds));
  c.header('RateLimit-Limit', String(options.max));
  c.header('RateLimit-Remaining', '0');
  c.header('RateLimit-Reset', String(seconds));
  return c.json({ error: 'too_many_requests', requestId: c.get('requestId') ?? null }, 429);
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const window = new SlidingWindow(options.windowMs, options.max);
  const now = options.now ?? (() => Date.now());
  const mode = options.mode ?? 'request';
  let lastSweep = now();
  return async (c, next) => {
    const key = options.keyOf(c);
    if (key === null) {
      await next();
      return;
    }
    const at = now();
    if (at - lastSweep > options.windowMs) {
      window.sweep(at);
      lastSweep = at;
    }
    if (window.isLimited(key, at) || window.full(key, at)) {
      return tooMany(c, options, window.retryAfterMs(key, at) || options.windowMs);
    }
    if (mode === 'request') {
      const used = window.hit(key, at);
      await next();
      c.res.headers.set('RateLimit-Limit', String(options.max));
      c.res.headers.set('RateLimit-Remaining', String(Math.max(0, options.max - used)));
      return;
    }
    await next();
    if (c.res.status === 401) {
      window.hit(key, at);
    }
  };
}

/**
 * The caller's address. With TRUSTED_PROXY_HOPS=n the address n from the right
 * of X-Forwarded-For is trusted (the one the proxy itself appended); with 0,
 * only the socket's address counts and the header is ignored.
 */
export function addressKey(trustedProxyHops: number): (c: Context) => string | null {
  return (c) => {
    if (trustedProxyHops > 0) {
      const forwarded = (c.req.header('x-forwarded-for') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const chosen = forwarded[forwarded.length - trustedProxyHops];
      if (chosen && chosen.length <= 45 && isIP(chosen) !== 0) return `ip:${chosen}`;
    }
    try {
      const address = getConnInfo(c).remote.address;
      // No address means no bucket: a shared "unknown" bucket would let one
      // caller spend everyone's budget.
      return address ? `ip:${address}` : null;
    } catch {
      return null;
    }
  };
}

export type RateLimits = {
  perMinute: number;
  actorPerMinute: number;
  authFailuresPerMinute: number;
  devDoorPerMinute: number;
  /**
   * The portal's invitation door, which answers somebody who is not signed in
   * (docs/SPEC/client-portal.md sections 7 and 10). Ten a minute per address:
   * a household redeems one link once, and the budget is what makes guessing a
   * 32-byte token pointless rather than merely hard.
   */
  inviteDoorPerMinute: number;
  /** The website's enquiry door: public, and the one write a stranger can make. */
  enquiryDoorPerMinute: number;
};

export const DEFAULT_LIMITS: RateLimits = {
  perMinute: 300,
  actorPerMinute: 600,
  authFailuresPerMinute: 20,
  devDoorPerMinute: 30,
  inviteDoorPerMinute: 10,
  enquiryDoorPerMinute: 10,
};

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Budgets from the environment, with the defaults above. */
export function limitsFromEnv(env: NodeJS.ProcessEnv): RateLimits {
  return {
    perMinute: positiveInt(env.RATE_LIMIT_PER_MINUTE, DEFAULT_LIMITS.perMinute),
    actorPerMinute: positiveInt(env.RATE_LIMIT_ACTOR_PER_MINUTE, DEFAULT_LIMITS.actorPerMinute),
    authFailuresPerMinute: positiveInt(
      env.RATE_LIMIT_AUTH_FAILURES_PER_MINUTE,
      DEFAULT_LIMITS.authFailuresPerMinute,
    ),
    devDoorPerMinute: positiveInt(
      env.RATE_LIMIT_DEV_DOOR_PER_MINUTE,
      DEFAULT_LIMITS.devDoorPerMinute,
    ),
    inviteDoorPerMinute: positiveInt(
      env.RATE_LIMIT_INVITE_DOOR_PER_MINUTE,
      DEFAULT_LIMITS.inviteDoorPerMinute,
    ),
    enquiryDoorPerMinute: positiveInt(
      env.RATE_LIMIT_ENQUIRY_DOOR_PER_MINUTE,
      DEFAULT_LIMITS.enquiryDoorPerMinute,
    ),
  };
}

export function trustedProxyHopsFromEnv(env: NodeJS.ProcessEnv): number {
  const n = Number(env.TRUSTED_PROXY_HOPS ?? '0');
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
