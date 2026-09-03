import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { StorageUnavailableError } from '../../../../domain/shared/storage';
import { storageFromEnv } from './index';
import { supabaseStorage } from './supabase';

/**
 * The seam's own tests (CLAUDE.md, the seam pattern): which implementation a
 * deployment gets, and that choosing wrong is refused rather than guessed at.
 * The forced-fallback proof itself — the whole document path working with the
 * real implementation disabled — is app/api/storage-seam.test.ts.
 */

const DIR = join(tmpdir(), 'mcwellness-seam-choice');

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
