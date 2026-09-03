import { describe, expect, it } from 'vitest';
import { isWordingRefusal, wordingTargetError } from './wording-upload';

// Shapes, not connections: no password appears in either, which the secrets
// scan insists on and which nothing here needs.
const LOCAL = 'postgresql://postgres@localhost:5442/postgres';
const HOSTED = 'postgresql://mcwellness_api.ref@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

describe('wordingTargetError', () => {
  it('lets the folder store fill a database on this machine', () => {
    expect(wordingTargetError('local', LOCAL)).toBeNull();
    expect(wordingTargetError('local', 'postgresql://postgres@127.0.0.1:5432/postgres')).toBeNull();
  });

  it('refuses to file a hosted practice into a folder, and names the two settings', () => {
    const refusal = wordingTargetError('local', HOSTED);
    expect(refusal).toContain('STORAGE_PROVIDER=supabase');
    expect(refusal).toContain('SUPABASE_STORAGE_KEY');
    // The refusal explains itself without echoing the connection string.
    expect(refusal).not.toContain('supabase.com');
  });

  it('lets the real implementation fill either, since it reaches a bucket in both', () => {
    expect(wordingTargetError('supabase', HOSTED)).toBeNull();
    expect(wordingTargetError('supabase', LOCAL)).toBeNull();
  });

  it('refuses a host that only looks local, the way the seed runner reads one', () => {
    // The driver lets ?host= override the hostname; db/runner/plan.ts knows it.
    expect(wordingTargetError('local', `${LOCAL}?host=db.example.com`)).not.toBeNull();
  });
});

describe('isWordingRefusal', () => {
  it('counts a disagreement between file and row, and nothing that went well', () => {
    expect(isWordingRefusal('hash mismatch')).toBe(true);
    expect(isWordingRefusal('no row')).toBe(true);
    expect(isWordingRefusal('uploaded')).toBe(false);
    expect(isWordingRefusal('already present')).toBe(false);
  });
});
