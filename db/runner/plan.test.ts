import { describe, expect, it } from 'vitest';
import {
  checkNeeds,
  checksumOf,
  hasRollbackBlock,
  isLocalDatabaseUrl,
  listMigrationFiles,
  listPolicyFiles,
  parseNeeds,
  planChecksums,
  planMigrations,
} from './plan';

describe('listMigrationFiles', () => {
  it('orders files by their number, not by name', () => {
    const files = listMigrationFiles(['010_audit_log.sql', '002_user.sql', '001_tenant.sql']);

    expect(files.map((file) => file.filename)).toEqual([
      '001_tenant.sql',
      '002_user.sql',
      '010_audit_log.sql',
    ]);
  });

  it('ignores dotfiles such as .gitkeep', () => {
    expect(listMigrationFiles(['.gitkeep', '001_tenant.sql'])).toEqual([
      { filename: '001_tenant.sql', number: 1 },
    ]);
  });

  it('refuses a file that does not follow NNN_description.sql', () => {
    expect(() => listMigrationFiles(['tenant.sql'])).toThrow('not a migration file name');
    expect(() => listMigrationFiles(['1_tenant.sql'])).toThrow('not a migration file name');
    expect(() => listMigrationFiles(['001_tenant.txt'])).toThrow('not a migration file name');
  });

  it('refuses two files that share a number', () => {
    expect(() => listMigrationFiles(['001_tenant.sql', '001_user.sql'])).toThrow(
      'share the number',
    );
  });
});

describe('hasRollbackBlock', () => {
  it('finds the marker regardless of case and spacing', () => {
    expect(hasRollbackBlock('create table t ();\n-- rollback:\n-- drop table t;\n')).toBe(true);
    expect(hasRollbackBlock('create table t ();\n--Rollback:\n-- drop table t;\n')).toBe(true);
  });

  it('is false when the marker is absent or not at the start of a line', () => {
    expect(hasRollbackBlock('create table t ();\n')).toBe(false);
    expect(hasRollbackBlock('create table t (); -- rollback: drop table t;\n')).toBe(false);
  });
});

describe('planMigrations', () => {
  const available = listMigrationFiles(['001_tenant.sql', '002_user.sql', '003_role.sql']);

  it('returns every file when nothing has been applied', () => {
    expect(planMigrations(available, []).map((file) => file.number)).toEqual([1, 2, 3]);
  });

  it('returns only the files that are not yet applied, in order', () => {
    const pending = planMigrations(available, ['001_tenant.sql']);

    expect(pending.map((file) => file.filename)).toEqual(['002_user.sql', '003_role.sql']);
  });

  it('returns nothing when everything is applied', () => {
    expect(planMigrations(available, ['001_tenant.sql', '002_user.sql', '003_role.sql'])).toEqual(
      [],
    );
  });

  it('refuses when an applied file has disappeared from disk', () => {
    expect(() => planMigrations(available, ['001_tenant.sql', '004_gone.sql'])).toThrow(
      'missing from db/migrations',
    );
  });

  it('plans a new file numbered below one already applied, in filename order', () => {
    // Which migrations a database has already seen depends on which streams'
    // ranges have reached it, never on every range being present (docs/SPEC/OWNERSHIP.md):
    // a database that has already applied a stream's 400 has not thereby
    // applied the trunk's 099, and refusing 099 there would make the trunk's
    // own range unappliable behind whichever stream got there first.
    const withAGap = listMigrationFiles([
      '001_tenant.sql',
      '002_user.sql',
      '003_role.sql',
      '099_trunk_only.sql',
      '400_billing_only.sql',
    ]);
    const pending = planMigrations(withAGap, [
      '001_tenant.sql',
      '002_user.sql',
      '003_role.sql',
      '400_billing_only.sql',
    ]);

    expect(pending.map((file) => file.filename)).toEqual(['099_trunk_only.sql']);
  });

  it('still refuses two files that share a number, from listMigrationFiles', () => {
    expect(() => listMigrationFiles(['001_tenant.sql', '001_user.sql'])).toThrow(
      'share the number',
    );
  });
});

describe('isLocalDatabaseUrl', () => {
  it('accepts the loopback hosts', () => {
    expect(isLocalDatabaseUrl('postgresql://postgres:postgres@localhost:5432/mcwellness')).toBe(
      true,
    );
    expect(isLocalDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5433/mcwellness')).toBe(
      true,
    );
    expect(isLocalDatabaseUrl('postgresql://postgres:postgres@[::1]:5432/mcwellness')).toBe(true);
  });

  it('refuses any other host', () => {
    expect(isLocalDatabaseUrl('postgresql://postgres:postgres@db.example.internal:5432/x')).toBe(
      false,
    );
  });

  it('refuses a host override hidden in the query string', () => {
    expect(
      isLocalDatabaseUrl(
        'postgresql://postgres:postgres@localhost:5432/x?host=db.example.internal',
      ),
    ).toBe(false);
    expect(
      isLocalDatabaseUrl('postgresql://postgres:postgres@localhost:5432/x?HostAddr=10.0.0.5'),
    ).toBe(false);
  });

  it('allows other query parameters', () => {
    expect(
      isLocalDatabaseUrl('postgresql://postgres:postgres@localhost:5432/x?sslmode=disable'),
    ).toBe(true);
  });
});

describe('listPolicyFiles', () => {
  it('keeps only .sql files, in path order', () => {
    expect(
      listPolicyFiles([
        'core/tenant_isolation.sql',
        'README.md',
        'core/audit_log.sql',
        'client/client_roles.sql',
        'core/.gitkeep',
      ]),
    ).toEqual(['client/client_roles.sql', 'core/audit_log.sql', 'core/tenant_isolation.sql']);
  });

  it('ignores dotfiles at any depth', () => {
    expect(listPolicyFiles(['.hidden/x.sql', 'core/.draft.sql'])).toEqual([]);
  });
});

describe('checksumOf', () => {
  it('is a deterministic 64-character lowercase hex digest', () => {
    const digest = checksumOf('create table t ();\n');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(checksumOf('create table t ();\n')).toBe(digest);
  });

  it('changes when the text changes by even one character', () => {
    expect(checksumOf('create table t ();\n')).not.toBe(checksumOf('create table t();\n'));
  });
});

describe('parseNeeds', () => {
  it('is empty when the file carries no "-- Needs:" comment', () => {
    expect(parseNeeds('create table t ();\n-- rollback:\n-- drop table t;\n')).toEqual([]);
  });

  it('reads the numbers on the "-- Needs:" line itself', () => {
    expect(
      parseNeeds('-- 200_appointment.sql\n-- Needs: 010, 040, 060\n\ncreate table t ();\n'),
    ).toEqual([10, 40, 60]);
  });

  it('follows the comment onto the immediately following "--" lines, stopping at the first that is not one', () => {
    const sql =
      '-- 099_tenant_scoped_keys.sql\n' +
      '-- Needs: 010 (tenant, for tenant_id itself), 020 (app_user, user_role), 030\n' +
      '-- (location), 040 (service_type), 050 (practitioner, credential), 060\n' +
      '-- (client, contact, consent, document).\n' +
      '\n' +
      'alter table app_user add constraint x unique (tenant_id, id);\n';
    expect(parseNeeds(sql)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('is case-insensitive on the marker and de-duplicates repeated numbers', () => {
    expect(parseNeeds('-- needs: 010, 010, 020\n')).toEqual([10, 20]);
  });
});

describe('checkNeeds', () => {
  it('passes a migration whose needs are all strictly earlier than its own number', () => {
    expect(() =>
      checkNeeds({ filename: '200_appointment.sql', number: 200 }, '-- Needs: 010, 040, 099\n'),
    ).not.toThrow();
  });

  it('passes a migration with no "-- Needs:" comment at all', () => {
    expect(() =>
      checkNeeds({ filename: '200_appointment.sql', number: 200 }, 'create table t ();\n'),
    ).not.toThrow();
  });

  it('refuses a migration whose "-- Needs:" comment names a number above its own', () => {
    expect(() =>
      checkNeeds({ filename: '200_appointment.sql', number: 200 }, '-- Needs: 010, 300\n'),
    ).toThrow('names 300');
  });

  it('refuses a migration that names its own number, which is not earlier than itself', () => {
    expect(() =>
      checkNeeds({ filename: '200_appointment.sql', number: 200 }, '-- Needs: 200\n'),
    ).toThrow('not earlier than its own number');
  });
});

describe('planChecksums', () => {
  it("backfills a null recorded checksum from the file's current text, rather than refusing", () => {
    const plan = planChecksums(
      [{ filename: '000_foundation.sql', checksum: null }],
      () => 'create schema app;\n',
    );
    expect(plan.mismatched).toEqual([]);
    expect(plan.toBackfill).toEqual([
      { filename: '000_foundation.sql', checksum: checksumOf('create schema app;\n') },
    ]);
  });

  it('is silent when the recorded checksum still matches the current text', () => {
    const text = 'create table t ();\n';
    const plan = planChecksums(
      [{ filename: '010_tenant.sql', checksum: checksumOf(text) }],
      () => text,
    );
    expect(plan.mismatched).toEqual([]);
    expect(plan.toBackfill).toEqual([]);
  });

  it('flags a file whose current text no longer matches its recorded checksum', () => {
    const plan = planChecksums(
      [{ filename: '010_tenant.sql', checksum: checksumOf('create table t ();\n') }],
      () => 'create table t (id uuid);\n',
    );
    expect(plan.mismatched).toEqual(['010_tenant.sql']);
    expect(plan.toBackfill).toEqual([]);
  });

  it('handles a mix of matching, mismatched and null-checksum files independently', () => {
    const matching = 'create table a ();\n';
    const mismatched = 'create table b ();\n';
    const plan = planChecksums(
      [
        { filename: 'a.sql', checksum: checksumOf(matching) },
        { filename: 'b.sql', checksum: checksumOf('create table b (id uuid);\n') },
        { filename: 'c.sql', checksum: null },
      ],
      (filename) =>
        filename === 'b.sql'
          ? mismatched
          : filename === 'a.sql'
            ? matching
            : 'create table c ();\n',
    );
    expect(plan.mismatched).toEqual(['b.sql']);
    expect(plan.toBackfill).toEqual([
      { filename: 'c.sql', checksum: checksumOf('create table c ();\n') },
    ]);
  });
});
