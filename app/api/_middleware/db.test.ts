import { describe, expect, it } from 'vitest';
import { assertApiRoleUrl } from './db';

describe('assertApiRoleUrl', () => {
  it('accepts the API role locally and through the Supabase pooler', () => {
    expect(() =>
      assertApiRoleUrl('postgresql://mcwellness_api:x@localhost:5432/postgres'),
    ).not.toThrow();
    expect(() =>
      assertApiRoleUrl(
        'postgresql://mcwellness_api.abcdefghij:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
      ),
    ).not.toThrow();
  });

  it('refuses the owner and every Supabase system role', () => {
    for (const user of [
      'postgres',
      'postgres.abcdefghij',
      'authenticator',
      'service_role',
      'supabase_admin',
    ]) {
      expect(() => assertApiRoleUrl(`postgresql://${user}:x@localhost:5432/postgres`)).toThrow(
        'must connect as mcwellness_api',
      );
    }
  });
});
