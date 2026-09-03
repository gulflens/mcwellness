import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { StorageConflictError, StorageUnavailableError } from '../../../../domain/shared/storage';
import { storageFromEnv } from './index';
import { localDiskStorage } from './local-disk';
import { supabaseStorage } from './supabase';

/**
 * The seam's own tests (CLAUDE.md, the seam pattern): which implementation a
 * deployment gets, and that choosing wrong is refused rather than guessed at.
 * The forced-fallback proof itself — the whole document path working with the
 * real implementation disabled — is app/api/storage-seam.test.ts.
 */

const DIR = join(tmpdir(), 'mcwellness-seam-choice');
const KEY =
  'tenant/00000000-0000-4000-8000-00000000000a/practice/00000000-0000-4000-8000-0000000000f1';
const BYTES = new TextEncoder().encode('Draft consent wording, synthetic.');

/** A JWT-shaped value whose payload claims a role. Signed by nobody, and never verified. */
function jwtWithRole(role: string): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role })}.not-a-signature`;
}

afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
});

describe('choosing an implementation', () => {
  it('falls back to the local folder on a laptop and in the tests, unasked', () => {
    for (const APP_ENV of ['development', 'test']) {
      const storage = storageFromEnv({ APP_ENV, STORAGE_DIR: DIR } as NodeJS.ProcessEnv);
      expect(storage.kind).toBe('local');
      expect(storage.describe()).toContain(DIR);
    }
  });

  it('refuses to start on staging or production without an explicit choice', () => {
    for (const APP_ENV of ['staging', 'production', undefined]) {
      expect(() => storageFromEnv({ APP_ENV } as NodeJS.ProcessEnv)).toThrow(
        'STORAGE_PROVIDER is not set',
      );
    }
  });

  it('takes either implementation when it is named', () => {
    const local = storageFromEnv({
      APP_ENV: 'staging',
      STORAGE_PROVIDER: 'local',
      STORAGE_DIR: DIR,
    } as NodeJS.ProcessEnv);
    const supabase = storageFromEnv({
      APP_ENV: 'staging',
      STORAGE_PROVIDER: 'supabase',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_STORAGE_KEY: 'not-a-real-key',
    } as NodeJS.ProcessEnv);

    expect(local.kind).toBe('local');
    expect(supabase.kind).toBe('supabase');
    expect(supabase.describe()).toBe(
      'Supabase Storage bucket "documents" at https://project.supabase.co',
    );
  });

  it('never lets the credential reach the line it logs at startup', () => {
    const supabase = storageFromEnv({
      APP_ENV: 'staging',
      STORAGE_PROVIDER: 'supabase',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_STORAGE_KEY: 'sbp-nothing-real-0123456789',
    } as NodeJS.ProcessEnv);

    expect(supabase.describe()).not.toContain('sbp-nothing-real-0123456789');
  });

  it('says what is missing rather than starting half-configured', () => {
    expect(() =>
      storageFromEnv({ APP_ENV: 'staging', STORAGE_PROVIDER: 'supabase' } as NodeJS.ProcessEnv),
    ).toThrow('needs SUPABASE_URL');
    expect(() =>
      storageFromEnv({
        APP_ENV: 'staging',
        STORAGE_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://project.supabase.co',
      } as NodeJS.ProcessEnv),
    ).toThrow('SUPABASE_STORAGE_KEY');
    expect(() =>
      storageFromEnv({ APP_ENV: 'staging', STORAGE_PROVIDER: 'bucket' } as NodeJS.ProcessEnv),
    ).toThrow('it is "supabase" or "local"');
  });

  it('never takes the anon key as the storage credential', () => {
    expect(() =>
      storageFromEnv({
        APP_ENV: 'staging',
        STORAGE_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_ANON_KEY: 'the browser holds this one',
      } as NodeJS.ProcessEnv),
    ).toThrow('never the anon key');
  });

  it("refuses a key that says in its own payload that it is the browser's", () => {
    expect(() =>
      storageFromEnv({
        APP_ENV: 'staging',
        STORAGE_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_STORAGE_KEY: jwtWithRole('anon'),
      } as NodeJS.ProcessEnv),
    ).toThrow('carries the anon role');
  });

  it('takes a key whose payload names a role that may write, and one that claims nothing', () => {
    for (const key of [jwtWithRole('service_role'), 'sb_secret_nothing_real_0123456789']) {
      const storage = storageFromEnv({
        APP_ENV: 'staging',
        STORAGE_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_STORAGE_KEY: key,
      } as NodeJS.ProcessEnv);
      expect(storage.kind).toBe('supabase');
    }
  });

  it("never promotes the project's own service-role key into the storage credential", () => {
    // A variable whose whole purpose is to say "this credential may write
    // documents" means nothing if another one stands in when it is absent.
    expect(() =>
      storageFromEnv({
        APP_ENV: 'staging',
        STORAGE_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: jwtWithRole('service_role'),
      } as NodeJS.ProcessEnv),
    ).toThrow('SUPABASE_STORAGE_KEY');
  });

  it('reads a blank value as the variable nobody filled in', () => {
    expect(() =>
      storageFromEnv({
        APP_ENV: 'staging',
        STORAGE_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_STORAGE_KEY: '   ',
      } as NodeJS.ProcessEnv),
    ).toThrow('SUPABASE_STORAGE_KEY');
  });
});

describe('the real implementation, unreachable', () => {
  const unreachable = supabaseStorage({
    url: 'http://127.0.0.1:1',
    serviceKey: 'not-a-real-key',
    timeoutMs: 250,
  });

  it('is built without touching the network', () => {
    expect(unreachable.kind).toBe('supabase');
  });

  it('turns every call into one plain outage, never a stack trace from a vendor', async () => {
    for (const call of [
      () => unreachable.exists('tenant/a/practice/b'),
      () => unreachable.getSignedUrl('tenant/a/practice/b', 60),
      () => unreachable.delete('tenant/a/practice/b'),
      () => unreachable.put('tenant/a/practice/b', new Uint8Array([1]), 'text/plain'),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(StorageUnavailableError);
      await expect(call()).rejects.toThrow('The document store could not be reached.');
    }
  });

  it('reads a refusal from the vendor as an outage too, without echoing its body', async () => {
    const refusing = supabaseStorage({
      url: 'https://project.supabase.co',
      serviceKey: 'not-a-real-key',
      fetchImpl: async () =>
        new Response('{"error":"Object not found for tenant/a/client/c1/d1"}', { status: 500 }),
    });

    const failure = await refusing.exists('tenant/a/practice/b').catch((error: Error) => error);

    expect((failure as Error).message).toBe(
      'The document store refused to look for that document (status 500).',
    );
  });

  it('reads a missing object as absent, not as an outage', async () => {
    const empty = supabaseStorage({
      url: 'https://project.supabase.co',
      serviceKey: 'not-a-real-key',
      fetchImpl: async () => new Response('', { status: 404 }),
    });

    expect(await empty.exists('tenant/a/practice/b')).toBe(false);
    await expect(empty.delete('tenant/a/practice/b')).resolves.toBeUndefined();
  });
});

describe('the headers a call actually sends', () => {
  // Short on purpose: a longer fake reads as an assigned secret to
  // scripts/audit-secrets.mjs, and this one only has to be recognisable.
  const SERVICE_KEY = 'no-key';

  /** Records what the seam asked the network for, and answers plausibly. */
  function recorder(): {
    calls: { url: string; headers: Record<string, string>; body: unknown }[];
    fetchImpl: typeof fetch;
  } {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body,
      });
      return new Response(JSON.stringify({ signedURL: '/object/sign/documents/k?token=t' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    return { calls, fetchImpl };
  }

  it('puts a document with its own content type, its upsert decision, and the credential', async () => {
    // The fault this proves gone: `{ ...init, headers, signal }` spread the
    // credential AFTER the call's own headers, so every per-call header was
    // thrown away — a put sent no content type and no upsert decision at all.
    const { calls, fetchImpl } = recorder();
    const storage = supabaseStorage({
      url: 'https://project.supabase.co',
      serviceKey: SERVICE_KEY,
      fetchImpl,
    });

    await storage.put(KEY, BYTES, 'text/markdown');
    await storage.put(KEY, BYTES, 'application/pdf', { overwrite: true });

    expect(calls[0]?.headers).toEqual({
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'text/markdown',
      'x-upsert': 'false',
    });
    expect(calls[1]?.headers['content-type']).toBe('application/pdf');
    expect(calls[1]?.headers['x-upsert']).toBe('true');
  });

  it('signs a link with JSON labelled as JSON, and the credential still on', async () => {
    const { calls, fetchImpl } = recorder();
    const storage = supabaseStorage({
      url: 'https://project.supabase.co',
      serviceKey: SERVICE_KEY,
      fetchImpl,
    });

    const url = await storage.getSignedUrl(KEY, 60);

    expect(calls[0]?.headers).toEqual({
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    });
    expect(calls[0]?.body).toBe(JSON.stringify({ expiresIn: 60 }));
    expect(url).toBe('https://project.supabase.co/storage/v1/object/sign/documents/k?token=t');
  });

  it('keeps the credential on the calls that set no header of their own', async () => {
    const { calls, fetchImpl } = recorder();
    const storage = supabaseStorage({
      url: 'https://project.supabase.co',
      serviceKey: SERVICE_KEY,
      fetchImpl,
    });

    await storage.exists(KEY);
    await storage.delete(KEY);

    for (const call of calls) {
      expect(call.headers.apikey).toBe(SERVICE_KEY);
      expect(call.headers.authorization).toBe(`Bearer ${SERVICE_KEY}`);
    }
  });
});

describe('a document is written once', () => {
  it('refuses a second write to the same key, on the bucket', async () => {
    // The vendor's own 409, asked for by `x-upsert: false`: the check and the
    // write are one operation, with no window between them.
    const storage = supabaseStorage({
      url: 'https://project.supabase.co',
      serviceKey: 'not-a-real-key',
      fetchImpl: async () => new Response('{"error":"Duplicate"}', { status: 409 }),
    });

    await expect(storage.put(KEY, BYTES, 'text/markdown')).rejects.toBeInstanceOf(
      StorageConflictError,
    );
    await expect(storage.put(KEY, BYTES, 'text/markdown')).rejects.toThrow(
      'Something is already stored under that key.',
    );
  });

  it('takes the same 409 as an ordinary refusal when the caller did ask to replace', async () => {
    const storage = supabaseStorage({
      url: 'https://project.supabase.co',
      serviceKey: 'not-a-real-key',
      fetchImpl: async () => new Response('{"error":"Duplicate"}', { status: 409 }),
    });

    await expect(
      storage.put(KEY, BYTES, 'text/markdown', { overwrite: true }),
    ).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('refuses a second write to the same key, on the folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcwellness-write-once-'));
    try {
      const storage = localDiskStorage({ dir });
      await storage.put(KEY, BYTES, 'text/markdown');

      const second = new TextEncoder().encode('A different wording entirely.');
      await expect(storage.put(KEY, second, 'text/markdown')).rejects.toBeInstanceOf(
        StorageConflictError,
      );
      // And the first bytes are still the ones in the folder.
      expect(await storage.read(KEY)).toEqual(Buffer.from(BYTES));

      // Only a caller that says so replaces them.
      await storage.put(KEY, second, 'text/markdown', { overwrite: true });
      expect(await storage.read(KEY)).toEqual(Buffer.from(second));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the folder store and a link planted inside it', () => {
  it('refuses to read through a link that leads out of the folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcwellness-symlink-'));
    const outside = join(dir, 'outside.txt');
    const root = join(dir, 'store');
    try {
      await writeFile(outside, 'a file the folder store has no business reading');
      await mkdir(join(root, dirname(KEY)), { recursive: true });
      await symlink(outside, join(root, KEY));
      const storage = localDiskStorage({ dir: root });

      // The name resolves inside the folder; the filesystem says otherwise.
      await expect(storage.read(KEY)).rejects.toThrow('That storage key is not a valid one.');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses to write into a directory that is a link out of the folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcwellness-symlink-'));
    const elsewhere = join(dir, 'elsewhere');
    const root = join(dir, 'store');
    try {
      await mkdir(elsewhere, { recursive: true });
      await mkdir(join(root, dirname(dirname(KEY))), { recursive: true });
      await symlink(elsewhere, join(root, dirname(KEY)));
      const storage = localDiskStorage({ dir: root });

      await expect(storage.put(KEY, BYTES, 'text/markdown')).rejects.toThrow(
        'That storage key is not a valid one.',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the vendor says a missing object is a 400, not a 404', () => {
  // Seen on staging on 2026-09-04: object/info on a key that is not there
  // answers HTTP 400 with {"statusCode":"404","error":"not_found","code":"NoSuchKey"}.
  const noSuchKey = () =>
    new Response(JSON.stringify({ statusCode: '404', error: 'not_found', code: 'NoSuchKey' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  const KEY =
    'tenant/00000001-0000-4000-8000-000000000001/practice/0000000a-0000-4000-8000-000000000011';

  it('reads that answer as absent', async () => {
    const store = supabaseStorage({
      url: 'https://project.supabase.co',
      serviceKey: 'not-a-real-key',
      fetchImpl: async () => noSuchKey(),
    });
    expect(await store.exists(KEY)).toBe(false);
  });

  it('still treats any other 400 as a refusal', async () => {
    const store = supabaseStorage({
      url: 'https://project.supabase.co',
      serviceKey: 'not-a-real-key',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ statusCode: '400', error: 'InvalidRequest', message: 'bad' }),
          {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
        ),
    });
    await expect(store.exists(KEY)).rejects.toThrow();
  });
});
