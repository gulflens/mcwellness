import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

/**
 * Verifies a Supabase Auth access token without calling Supabase per request.
 *
 * Supabase signs tokens with published asymmetric keys (a JWKS endpoint,
 * ES256 or RS256); older projects still use the legacy HS256 shared secret.
 * One verifier supports both, choosing the key by the token's `alg`: jose
 * refuses to use a symmetric secret for an asymmetric algorithm and vice
 * versa, so mixing the two is safe against algorithm confusion.
 */

export const AuthClaims = z.object({
  sub: z.uuid(),
  // The anon and service-role API keys are JWTs too; only a signed-in person passes.
  role: z.literal('authenticated'),
  is_anonymous: z.boolean().optional(),
});
export type AuthClaims = z.infer<typeof AuthClaims>;

export type TokenVerifier = {
  /** The claims of a valid token, or null for any failure (never the reason). */
  verify(token: string): Promise<AuthClaims | null>;
};

export type VerifierConfig = {
  /** `${SUPABASE_URL}/auth/v1` */
  issuer: string;
  /** Projects on signing keys: the JWKS endpoint. */
  jwksUrl?: string;
  /** Legacy projects and local development: the shared secret. */
  secret?: string;
  clockToleranceSeconds?: number;
};

export function createTokenVerifier(config: VerifierConfig): TokenVerifier {
  const secret = config.secret ? new TextEncoder().encode(config.secret) : undefined;
  const jwks = config.jwksUrl
    ? createRemoteJWKSet(new URL(config.jwksUrl), {
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000,
        timeoutDuration: 5_000,
      })
    : undefined;
  if (!secret && !jwks) {
    throw new Error('Token verification needs SUPABASE_JWKS_URL or SUPABASE_JWT_SECRET.');
  }

  const algorithms = [...(secret ? ['HS256'] : []), ...(jwks ? ['ES256', 'RS256'] : [])];
  const getKey: JWTVerifyGetKey = (header, token) => {
    if (header.alg === 'HS256') {
      if (secret) {
        return secret;
      }
      throw new Error('HS256 is not configured');
    }
    if (jwks) {
      return jwks(header, token);
    }
    throw new Error(`no key source for ${header.alg}`);
  };

  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, getKey, {
          issuer: config.issuer,
          audience: 'authenticated',
          algorithms,
          clockTolerance: config.clockToleranceSeconds ?? 30,
          requiredClaims: ['sub', 'exp', 'iat'],
        });
        const claims = AuthClaims.safeParse(payload);
        if (!claims.success || claims.data.is_anonymous) {
          return null;
        }
        return claims.data;
      } catch {
        return null;
      }
    },
  };
}

/** The value shipped in .env.example. Fine on a laptop, refused anywhere else. */
export const LOCAL_PLACEHOLDER_SECRET = 'local-development-only-not-a-real-secret-0123456789';

/** Builds the verifier from the environment; throws at startup, never per request. */
export function verifierFromEnv(env: NodeJS.ProcessEnv): TokenVerifier {
  const supabaseUrl = env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is not set. Copy .env.example to .env.');
  }
  // Explicit, never assumed: a deployment that forgets APP_ENV is not a laptop.
  if (env.APP_ENV !== 'development' && env.SUPABASE_JWT_SECRET === LOCAL_PLACEHOLDER_SECRET) {
    throw new Error(
      'SUPABASE_JWT_SECRET is the local placeholder. Set APP_ENV=development locally, or SUPABASE_JWKS_URL for this environment.',
    );
  }
  return createTokenVerifier({
    issuer: `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`,
    jwksUrl: env.SUPABASE_JWKS_URL || undefined,
    secret: env.SUPABASE_JWT_SECRET || undefined,
  });
}
