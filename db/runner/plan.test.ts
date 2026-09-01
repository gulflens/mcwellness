import { describe, expect, it } from 'vitest';
import { hasRollbackBlock, listMigrationFiles, planMigrations } from './plan';

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

  it('refuses a new file numbered below one already applied', () => {
    expect(() => planMigrations(available, ['002_user.sql'])).toThrow(
      'numbered below the highest applied migration (2)',
    );
  });
});
