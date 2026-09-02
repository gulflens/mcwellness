import type { Hono } from 'hono';
import { SignJWT } from 'jose';
import { z } from 'zod';
import { isLocalDatabaseUrl } from '../../db/runner/plan';
import { generateSeed } from '../../db/seed/generate';
import type { ApiEnv } from './_middleware/request-context';

/**
 * The development sign-in door: mints an access token for any auth id, signed
 * with the local secret, so a laptop can sign in as a seeded person without a
 * Supabase project. It exists only when every condition below holds; the server
 * never mounts it otherwise, and createApi never mounts it on its own.
 */

const Body = z.object({ authId: z.uuid() });
const ONE_HOUR = 60 * 60;

export type DevSessionOptions = { secret: string; issuer: string };

export function devSessionEnabled(env: {
  APP_ENV?: string | undefined;
  API_DATABASE_URL?: string | undefined;
  SUPABASE_JWT_SECRET?: string | undefined;
}): boolean {
  return (
    env.APP_ENV === 'development' &&
    typeof env.API_DATABASE_URL === 'string' &&
    isLocalDatabaseUrl(env.API_DATABASE_URL) &&
    typeof env.SUPABASE_JWT_SECRET === 'string' &&
    env.SUPABASE_JWT_SECRET.length > 0
  );
}

/** Mount BEFORE the request-context middleware: the door is how a session begins. */
export function mountDevSession(api: Hono<ApiEnv>, options: DevSessionOptions): void {
  const key = new TextEncoder().encode(options.secret);
  // The seeded people, so the sign-in screen can offer them by name. Synthetic by construction.
  api.get('/api/dev/session', (c) => {
    const seed = generateSeed();
    const rolesOf = (userId: string) =>
      seed.roles.filter((r) => r.userId === userId).map((r) => r.role);
    return c.json({
      people: seed.users.map((u) => ({
        authId: u.authId,
        displayName: u.displayName,
        roles: rolesOf(u.id),
      })),
    });
  });
  api.post('/api/dev/session', async (c) => {
    const body = Body.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request' }, 400);
    }
    const expiresAt = Math.floor(Date.now() / 1000) + ONE_HOUR;
    const token = await new SignJWT({ role: 'authenticated', is_anonymous: false })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(options.issuer)
      .setAudience('authenticated')
      .setSubject(body.data.authId)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(key);
    return c.json({ token, expiresAt });
  });
}
