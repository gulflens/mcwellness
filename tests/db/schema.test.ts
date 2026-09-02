import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase } from './helpers';

const CORE_TABLES = [
  'tenant',
  'app_user',
  'user_role',
  'location',
  'service_type',
  'practitioner',
  'credential',
  'client',
  'contact',
  'consent',
  'document',
];
const STANDARD_COLUMNS = ['id', 'tenant_id', 'created_at', 'updated_at', 'created_by'];

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
});

afterAll(async () => {
  await client.end();
});

async function columnsOf(table: string): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
    [table],
  );
  return rows.map((row) => row.column_name);
}

async function enumValues(name: string): Promise<string[]> {
  const { rows } = await client.query<{ label: string }>(
    'select e.enumlabel as label from pg_enum e join pg_type t on t.oid = e.enumtypid ' +
      'where t.typname = $1 order by e.enumsortorder',
    [name],
  );
  return rows.map((row) => row.label);
}

describe('core schema', () => {
  it('has exactly the section 2 and 3 tables plus audit_log and the bookkeeping tables', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' " +
        "and table_type = 'BASE TABLE' and table_name not like 'audit_log_%' " +
        "and table_name not in ('spatial_ref_sys') order by 1",
    );
    expect(rows.map((row) => row.table_name).sort()).toEqual(
      [...CORE_TABLES, 'audit_log', 'schema_migration'].sort(),
    );
  });

  it('gives every core table the standard columns, with the recorded exemption for tenant', async () => {
    for (const table of CORE_TABLES.filter((name) => name !== 'tenant')) {
      const columns = await columnsOf(table);
      for (const column of STANDARD_COLUMNS) {
        expect(columns, `${table}.${column}`).toContain(column);
      }
    }
    const tenant = await columnsOf('tenant');
    expect(tenant).toEqual(
      expect.arrayContaining(['id', 'created_at', 'updated_at', 'created_by']),
    );
    expect(tenant).not.toContain('tenant_id');
  });

  it('keeps the Emirates ID out of every text column', async () => {
    const { rows } = await client.query<{ column_name: string; data_type: string }>(
      "select column_name, data_type from information_schema.columns where table_schema = 'public' " +
        "and column_name like 'emirates_id%'",
    );
    expect(rows.map((row) => row.column_name).sort()).toEqual([
      'emirates_id_encrypted',
      'emirates_id_expiry',
      'emirates_id_hash',
    ]);
    for (const row of rows.filter((column) => column.column_name !== 'emirates_id_expiry')) {
      expect(row.data_type).toBe('bytea');
    }
  });

  it('enables row level security on every table, including the bookkeeping ones', async () => {
    const { rows } = await client.query<{ name: string }>(
      "select n.nspname || '.' || c.relname as name from pg_class c " +
        'join pg_namespace n on n.oid = c.relnamespace ' +
        "where c.relkind in ('r', 'p') and n.nspname in ('public', 'app') " +
        "and c.relname <> 'spatial_ref_sys' and not c.relrowsecurity",
    );
    expect(rows.map((row) => row.name)).toEqual([]);
  });

  it('has the extensions installed in the extensions schema', async () => {
    const { rows } = await client.query<{ extname: string; nspname: string }>(
      'select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace ' +
        "where e.extname in ('pgcrypto', 'postgis') order by 1",
    );
    expect(rows).toEqual([
      { extname: 'pgcrypto', nspname: 'extensions' },
      { extname: 'postgis', nspname: 'extensions' },
    ]);
  });

  it('defines the closed sets exactly as the data model lists them', async () => {
    expect(await enumValues('client_status')).toEqual([
      'lead',
      'active',
      'paused',
      'closed',
      'erased',
    ]);
    expect(await enumValues('consent_purpose')).toEqual([
      'participation',
      'minor_participation',
      'home_visit',
      'photo_video',
      'research',
      'marketing',
    ]);
    expect(await enumValues('role_kind')).toEqual([
      'owner',
      'admin',
      'lead_practitioner',
      'practitioner',
      'finance',
      'client_contact',
    ]);
    expect(await enumValues('emirate')).toEqual(['DXB', 'AUH', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ']);
    expect(await enumValues('consent_method')).toEqual([
      'app_signature',
      'paper_scan',
      'verbal_witnessed',
    ]);
  });

  it('attaches the audit trigger, set to fire always, to every section 2 and 3 table', async () => {
    const { rows } = await client.query<{ table: string; enabled: string }>(
      'select c.relname as table, t.tgenabled as enabled from pg_trigger t ' +
        "join pg_class c on c.oid = t.tgrelid where t.tgname = 'audit_row' order by 1",
    );
    expect(rows.map((row) => row.table).sort()).toEqual([...CORE_TABLES].sort());
    expect(rows.every((row) => row.enabled === 'A')).toBe(true);
  });

  it('has a tenant_isolation policy on every core table and two on the audit log', async () => {
    const { rows } = await client.query<{ tablename: string; policyname: string }>(
      "select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2",
    );
    for (const table of CORE_TABLES) {
      expect(rows).toContainEqual({ tablename: table, policyname: 'tenant_isolation' });
    }
    expect(rows).toContainEqual({ tablename: 'audit_log', policyname: 'audit_log_select' });
    expect(rows).toContainEqual({ tablename: 'audit_log', policyname: 'audit_log_insert' });
  });

  it('partitions the audit log by month, two years ahead, with a default partition', async () => {
    const { rows } = await client.query<{ name: string }>(
      'select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid ' +
        "where i.inhparent = 'public.audit_log'::regclass order by 1",
    );
    expect(rows).toHaveLength(26);
    expect(rows.map((row) => row.name)).toContain('audit_log_default');
    const thisMonth = new Date().toISOString().slice(0, 7).replace('-', '_');
    expect(rows.map((row) => row.name)).toContain(`audit_log_${thisMonth}`);
  });

  it('is idempotent: a second migrate applies nothing and re-applies the policies cleanly', async () => {
    const { runMigrations, applyPolicies } = await import('../../db/runner/apply');
    expect(await runMigrations(client)).toBe(0);
    expect(await applyPolicies(client)).toBe(2);
  });
});
