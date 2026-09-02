import { SignJWT, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { createTokenVerifier } from './token-verifier';

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-not-real-0123456789abcdef';
const SUB = '00000000-0000-4000-8000-0000000000aa';
const key = new TextEncoder().encode(SECRET);

type MintOptions = {
  issuer?: string;
  audience?: string;
  expiresIn?: string | number;
  claims?: Record<string, unknown>;
  sub?: string;
};

function mint(options: MintOptions = {}): Promise<string> {
  return new SignJWT({ role: 'authenticated', ...(options.claims ?? {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? 'authenticated')
    .setSubject(options.sub ?? SUB)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(key);
}

const verifier = createTokenVerifier({ issuer: ISSUER, secret: SECRET });

describe('createTokenVerifier', () => {
  it('refuses to start with neither a secret nor a key set', () => {
    expect(() => createTokenVerifier({ issuer: ISSUER })).toThrow('SUPABASE_JWKS_URL');
  });

  it('accepts a signed-in person and returns their subject', async () => {
    expect(await verifier.verify(await mint())).toEqual({ sub: SUB, role: 'authenticated' });
  });

  it('refuses an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 120;
    expect(await verifier.verify(await mint({ expiresIn: past }))).toBeNull();
  });

  it('refuses a token from another issuer or for another audience', async () => {
    expect(await verifier.verify(await mint({ issuer: 'http://elsewhere/auth/v1' }))).toBeNull();
    expect(await verifier.verify(await mint({ audience: 'anon' }))).toBeNull();
  });

  it('refuses a token signed with a different secret', async () => {
    const other = createTokenVerifier({
      issuer: ISSUER,
      secret: 'another-test-secret-that-unlocks-nothing-9876543210',
    });
    expect(await other.verify(await mint())).toBeNull();
  });

  it('refuses the anon and service-role keys, which are tokens too', async () => {
    expect(await verifier.verify(await mint({ claims: { role: 'anon' } }))).toBeNull();
    expect(await verifier.verify(await mint({ claims: { role: 'service_role' } }))).toBeNull();
  });

  it('refuses an anonymous session and a subject that is not a uuid', async () => {
    expect(await verifier.verify(await mint({ claims: { is_anonymous: true } }))).toBeNull();
    expect(await verifier.verify(await mint({ sub: 'not-a-uuid' }))).toBeNull();
  });

  it('refuses an asymmetric token when only the secret is configured, without any network', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setSubject(SUB)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    expect(await verifier.verify(token)).toBeNull();
  });

  it('refuses garbage', async () => {
    expect(await verifier.verify('not.a.token')).toBeNull();
    expect(await verifier.verify('')).toBeNull();
  });
});

describe('verifierFromEnv', () => {
  it('refuses the local placeholder secret anywhere but development', async () => {
    const { verifierFromEnv, LOCAL_PLACEHOLDER_SECRET } = await import('./token-verifier');
    const base = {
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_JWT_SECRET: LOCAL_PLACEHOLDER_SECRET,
    };
    expect(() => verifierFromEnv({ ...base, APP_ENV: 'development' })).not.toThrow();
    expect(() => verifierFromEnv({ ...base })).toThrow('local placeholder');
    expect(() => verifierFromEnv({ ...base, APP_ENV: 'staging' })).toThrow('local placeholder');
    expect(() => verifierFromEnv({ ...base, APP_ENV: 'production' })).toThrow('local placeholder');
  });
});
