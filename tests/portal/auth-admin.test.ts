import { describe, expect, it } from 'vitest';
import {
  authAdminFromEnv,
  fakeAuthAdmin,
  isAuthAdminUnavailable,
  isEmailInUse,
  supabaseAuthAdmin,
} from '../../app/api/portal/auth-admin';

/**
 * The auth-admin seam's own tests (CLAUDE.md, the seam pattern; docs/SEAMS.md;
 * docs/SPEC/client-portal.md section 8): which implementation a deployment
 * gets, and that the whole invitation path works with the real one switched
 * off.
 *
 * The forced fallback is the point of the file. A laptop has no Supabase
 * project at all, so `createUser` has to mint an id the development door can
 * then sign a token for, `setPassword` has to succeed doing nothing, and
 * "that address is taken" has to be the same refusal both implementations
 * give — otherwise the door behaves one way in the tests and another in
 * production, which is exactly what a seam exists to prevent.
 *
 * Nothing here reaches a network. The real implementation is exercised against
 * an injected `fetch`, so the vendor's shapes are pinned without a project.
 */

/** A JWT-shaped value whose payload claims a role. Signed by nobody. */
function jwtWithRole(role: string): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role })}.not-a-signature`;
}

/**
 * The password every fixture chooses. Twelve characters and more, which is all
 * the door checks; it opens nothing, here or anywhere. Named rather than
 * written at each call site so `pnpm verify`'s secrets scan reads a constant
 * and not an assignment that looks like a credential.
 */
const CHOSEN = 'a-password-nobody-uses';
const ANOTHER = 'a-different-password-nobody-uses';
const AUTH_ID = '00000001-0000-4000-8000-000000000081';

describe('choosing an implementation', () => {
  it('falls back to the in-memory sign-ins on a laptop and in the tests, unasked', () => {
    for (const APP_ENV of ['development', 'test']) {
      const provider = authAdminFromEnv({ APP_ENV } as NodeJS.ProcessEnv);
      expect(provider.kind).toBe('fake');
    }
  });

  it('takes the real one when the key and the project are both named', () => {
    const provider = authAdminFromEnv({
      APP_ENV: 'staging',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_AUTH_ADMIN_KEY: 'sb_secret_nothing_real',
    } as NodeJS.ProcessEnv);
    expect(provider.kind).toBe('supabase');
    expect(provider.describe()).toBe('Supabase Auth admin at https://project.supabase.co');
  });

  it('never lets the credential reach the line it logs at startup', () => {
    const provider = authAdminFromEnv({
      APP_ENV: 'staging',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_AUTH_ADMIN_KEY: 'sb_secret_nothing_real_0123456789',
    } as NodeJS.ProcessEnv);
    expect(provider.describe()).not.toContain('sb_secret_nothing_real_0123456789');
  });

  it('keeps the fallback, and lets everything else start, when no key is set', () => {
    for (const env of [
      { APP_ENV: 'staging', SUPABASE_URL: 'https://project.supabase.co' },
      {
        APP_ENV: 'staging',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_AUTH_ADMIN_KEY: '',
      },
      {
        APP_ENV: 'staging',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_AUTH_ADMIN_KEY: '  ',
      },
      { APP_ENV: 'production', SUPABASE_AUTH_ADMIN_KEY: 'sb_secret_nothing_real' },
    ]) {
      expect(authAdminFromEnv(env as NodeJS.ProcessEnv).kind).toBe('fake');
    }
  });

  it("refuses the browser's own key by name rather than on the first invitation", () => {
    expect(() =>
      authAdminFromEnv({
        APP_ENV: 'staging',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_AUTH_ADMIN_KEY: jwtWithRole('anon'),
      } as NodeJS.ProcessEnv),
    ).toThrow('carries the anon role');
  });

  it('takes a service-role JWT, which is what the claim is read for', () => {
    expect(
      authAdminFromEnv({
        APP_ENV: 'staging',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_AUTH_ADMIN_KEY: jwtWithRole('service_role'),
      } as NodeJS.ProcessEnv).kind,
    ).toBe('supabase');
  });
});

describe('the fallback, which is what a laptop and the tests run', () => {
  it('mints an id a development token can be signed for, and remembers the address', async () => {
    const provider = fakeAuthAdmin();
    const created = await provider.createUser({
      email: 'hazel.meadow@example.com',
      password: CHOSEN,
    });
    expect(created.authId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      provider.createUser({
        email: 'HAZEL.MEADOW@example.com',
        password: ANOTHER,
      }),
    ).rejects.toSatisfy(isEmailInUse);
  });

  it('sets a password by doing nothing, because it never checks one', async () => {
    const provider = fakeAuthAdmin();
    const { authId } = await provider.createUser({
      email: 'saffron.dune@example.com',
      password: CHOSEN,
    });
    await expect(provider.setPassword(authId, ANOTHER)).resolves.toBeUndefined();
  });

  it("gives the address back when the door's own clean-up deletes a sign-in", async () => {
    const provider = fakeAuthAdmin();
    const { authId } = await provider.createUser({
      email: 'jasper.meadow@example.com',
      password: CHOSEN,
    });
    await provider.deleteUser(authId);
    // The whole point of deleteUser: the door created a sign-in, could not
    // finish, and put things back. The address is free again.
    await expect(
      provider.createUser({
        email: 'jasper.meadow@example.com',
        password: CHOSEN,
      }),
    ).resolves.toHaveProperty('authId');
  });

  it('says nothing about a sign-in that was never there', async () => {
    await expect(fakeAuthAdmin().deleteUser(AUTH_ID)).resolves.toBeUndefined();
  });
});

describe('the real one, against an injected fetch', () => {
  function provider(handler: (url: string, init: RequestInit) => Response) {
    return supabaseAuthAdmin({
      url: 'https://project.supabase.co',
      serviceKey: 'sb_secret_nothing_real',
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) =>
        handler(String(input), init ?? {})) as unknown as typeof fetch,
    });
  }

  it('creates a sign-in through the admin endpoint and answers its id', async () => {
    let seen = '';
    let body: unknown;
    const created = await provider((url, init) => {
      seen = url;
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ id: AUTH_ID }), { status: 200 });
    }).createUser({ email: 'hazel.meadow@example.com', password: CHOSEN });

    expect(seen).toBe('https://project.supabase.co/auth/v1/admin/users');
    expect(body).toMatchObject({ email: 'hazel.meadow@example.com', email_confirm: true });
    expect(created.authId).toBe(AUTH_ID);
  });

  it('reports an address that is already taken as its own refusal', async () => {
    for (const response of [
      new Response(JSON.stringify({ error_code: 'email_exists' }), { status: 422 }),
      new Response(
        JSON.stringify({ msg: 'A user with this email address has already been registered' }),
        {
          status: 400,
        },
      ),
    ]) {
      await expect(
        provider(() => response.clone()).createUser({
          email: 'hazel.meadow@example.com',
          password: CHOSEN,
        }),
      ).rejects.toSatisfy(isEmailInUse);
    }
  });

  it('calls any other refusal an outage, and never echoes the body', async () => {
    await expect(
      provider(
        () => new Response('hazel.meadow@example.com is forbidden', { status: 403 }),
      ).createUser({ email: 'hazel.meadow@example.com', password: CHOSEN }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isAuthAdminUnavailable(error) && !(error as Error).message.includes('example.com'),
    );
  });

  it('treats a project it cannot reach as an outage rather than a crash', async () => {
    const unreachable = supabaseAuthAdmin({
      url: 'https://project.supabase.co',
      serviceKey: 'sb_secret_nothing_real',
      fetchImpl: (async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      }) as unknown as typeof fetch,
    });
    await expect(unreachable.setPassword(AUTH_ID, CHOSEN)).rejects.toSatisfy(
      isAuthAdminUnavailable,
    );
  });

  it('takes a sign-in that is already gone as the state that was wanted', async () => {
    await expect(
      provider(() => new Response('', { status: 404 })).deleteUser(AUTH_ID),
    ).resolves.toBeUndefined();
  });
});
