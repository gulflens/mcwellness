import pg from 'pg';
import {
  applyPolicies,
  connect,
  requireDatabaseUrl,
  resetDatabase,
  runMigrations,
  syncLocalApiRolePassword,
} from '../../db/runner/apply';
import { isLocalDatabaseUrl } from '../../db/runner/plan';

/**
 * Shared plumbing for the database tests. Every value here is synthetic and
 * stays inside the ranges the identifier hook reserves (.claude/hooks/no-real-identifiers.sh):
 * fictional names, phones in the +971 50 000 xxxx block, and never an identity number.
 */

export const IDS = {
  tenantA: '00000000-0000-4000-8000-00000000000a',
  tenantB: '00000000-0000-4000-8000-00000000000b',
  ownerA: '00000000-0000-4000-8000-0000000000a1',
  ownerB: '00000000-0000-4000-8000-0000000000b1',
  clientA: '00000000-0000-4000-8000-0000000000c1',
  clientB: '00000000-0000-4000-8000-0000000000c2',
  locationA: '00000000-0000-4000-8000-0000000000d1',
  locationB: '00000000-0000-4000-8000-0000000000d2',
  contactA: '00000000-0000-4000-8000-0000000000e1',
  request: '00000000-0000-4000-8000-0000000000ee',
} as const;

export const PHONES = {
  first: '+971500000001',
  second: '+971500000002',
} as const;

/** Wipes the local database and rebuilds it from the migrations and policies. */
export async function freshDatabase(): Promise<pg.Client> {
  const url = requireDatabaseUrl();
  if (!isLocalDatabaseUrl(url)) {
    throw new Error('Database tests only run against a local database.');
  }
  const appEnv = process.env.APP_ENV ?? 'development';
  if (appEnv !== 'development') {
    throw new Error(`Database tests only run with APP_ENV=development, not "${appEnv}".`);
  }
  const client = await connect(url);
  await resetDatabase(client);
  await runMigrations(client);
  await applyPolicies(client);
  await syncLocalApiRolePassword(client, process.env.API_DATABASE_URL);
  return client;
}

/** Runs `fn` inside a transaction that is always rolled back. */
export async function rolledBack<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

/** Stamps the audit context for the current transaction. */
export async function setAuditContext(
  client: pg.Client,
  actorId: string,
  reason = '',
): Promise<void> {
  await client.query(
    "select set_config('app.actor_id', $1, true), set_config('app.request_id', $2, true), " +
      "set_config('app.reason', $3, true)",
    [actorId, IDS.request, reason],
  );
}

/**
 * Runs `fn` as the API role with the given tenant (or none), inside a
 * savepoint, then restores the owner. The policies are written `to app_role`,
 * so this is how the deny cases are proved.
 */
export async function asApiRole<T>(
  client: pg.Client,
  tenantId: string | null,
  fn: () => Promise<T>,
  roles = 'owner',
): Promise<T> {
  await client.query('savepoint api_role');
  try {
    await client.query('set local role app_role');
    await client.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', $2, true)",
      [tenantId ?? '', roles],
    );
    return await fn();
  } finally {
    await client.query('rollback to savepoint api_role');
    await client.query('reset role');
  }
}

/**
 * Expects the statement to fail with the given SQLSTATE, inside a savepoint so
 * the surrounding transaction stays usable.
 */
export async function rejectsWith(
  client: pg.Client,
  code: string,
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  await client.query('savepoint expect_failure');
  let seen: string | undefined;
  try {
    await client.query(sql, params);
  } catch (error) {
    seen = (error as { code?: string }).code;
  } finally {
    await client.query('rollback to savepoint expect_failure');
  }
  if (seen !== code) {
    throw new Error(`expected SQLSTATE ${code}, got ${seen ?? 'success'}: ${sql}`);
  }
}

/** A tenant with one owner user. */
export async function seedTenant(
  client: pg.Client,
  tenantId: string,
  ownerId: string,
  name: string,
): Promise<void> {
  await client.query('insert into tenant (id, legal_name) values ($1, $2)', [tenantId, name]);
  await client.query(
    'insert into app_user (id, tenant_id, display_name, phone) values ($1, $2, $3, $4)',
    [ownerId, tenantId, `${name} Owner`, PHONES.first],
  );
  await client.query(
    "insert into user_role (tenant_id, user_id, role, created_by) values ($1, $2, 'owner', $2)",
    [tenantId, ownerId],
  );
}

/** A lead client. */
export async function seedClient(
  client: pg.Client,
  tenantId: string,
  clientId: string,
  ownerId: string,
  familyName: string,
): Promise<void> {
  await client.query(
    'insert into client (id, tenant_id, mrn, given_name, family_name, created_by) ' +
      "values ($1, $2, $3, 'Synthetic', $4, $5)",
    [clientId, tenantId, `MW-${clientId.slice(-6)}`, familyName, ownerId],
  );
}

/** An adult contact with a synthetic identity hash (never an identity number). */
export async function seedContact(
  client: pg.Client,
  tenantId: string,
  contactId: string,
  clientId: string,
  identity: string,
): Promise<void> {
  await client.query(
    'insert into contact (id, tenant_id, client_id, relationship, can_consent, phone, ' +
      'emirates_id_encrypted, emirates_id_hash) ' +
      "values ($1, $2, $3, 'mother', true, $4, 'ciphertext'::bytea, sha256(($5)::bytea))",
    [contactId, tenantId, clientId, PHONES.second, identity],
  );
}

/** A client home in Dubai with a verified entrance point. */
export async function seedLocation(
  client: pg.Client,
  tenantId: string,
  locationId: string,
  clientId: string,
  ownerId: string,
): Promise<void> {
  await client.query(
    'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, entrance_point, created_by) ' +
      "values ($1, $2, 'client', $3, 'home', 'DXB', " +
      "extensions.st_geogfromtext('SRID=4326;POINT(55.27 25.20)'), $4)",
    [locationId, tenantId, clientId, ownerId],
  );
}

export async function count(client: pg.Client, table: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(`select count(*)::text as n from ${table}`);
  return Number(rows[0]?.n ?? 0);
}

/** Auth ids (the Supabase user ids a token would carry). Synthetic. */
export const AUTH = {
  ownerA: '00000000-0000-4000-8000-0000000000aa',
  practitionerA: '00000000-0000-4000-8000-0000000000ab',
  adminA: '00000000-0000-4000-8000-0000000000ae',
  contactA: '00000000-0000-4000-8000-0000000000ac',
  suspendedA: '00000000-0000-4000-8000-0000000000ad',
  unknown: '00000000-0000-4000-8000-0000000000af',
} as const;

export const MORE_IDS = {
  practitionerUserA: '00000000-0000-4000-8000-0000000000a2',
  adminUserA: '00000000-0000-4000-8000-0000000000a5',
  contactUserA: '00000000-0000-4000-8000-0000000000a3',
  suspendedUserA: '00000000-0000-4000-8000-0000000000a4',
  practitionerA: '00000000-0000-4000-8000-0000000000b9',
  serviceTypeA: '00000000-0000-4000-8000-0000000000f1',
  locationB: '00000000-0000-4000-8000-0000000000d3',
  locationC: '00000000-0000-4000-8000-0000000000d4',
  locationD: '00000000-0000-4000-8000-0000000000d5',
  locationE: '00000000-0000-4000-8000-0000000000d6',
  locationF: '00000000-0000-4000-8000-0000000000d7',
} as const;

export async function seedUser(
  client: pg.Client,
  user: {
    id: string;
    tenantId: string;
    authId: string | null;
    displayName: string;
    status?: 'active' | 'suspended' | 'archived';
    roles?: readonly string[];
  },
): Promise<void> {
  await client.query(
    'insert into app_user (id, tenant_id, auth_id, display_name, status) values ($1, $2, $3, $4, $5)',
    [user.id, user.tenantId, user.authId, user.displayName, user.status ?? 'active'],
  );
  for (const role of user.roles ?? []) {
    await client.query(
      'insert into user_role (tenant_id, user_id, role) values ($1, $2, $3::role_kind)',
      [user.tenantId, user.id, role],
    );
  }
}

export async function seedServiceType(
  client: pg.Client,
  tenantId: string,
  id: string,
  code: string,
): Promise<void> {
  await client.query(
    'insert into service_type (id, tenant_id, code, name, duration_minutes, delivery_modes) ' +
      "values ($1, $2, $3, $3, 60, '{home}')",
    [id, tenantId, code],
  );
}

export async function seedPractitioner(
  client: pg.Client,
  tenantId: string,
  id: string,
  userId: string,
): Promise<void> {
  await client.query('insert into practitioner (id, tenant_id, user_id) values ($1, $2, $3)', [
    id,
    tenantId,
    userId,
  ]);
}

export async function seedCredential(
  client: pg.Client,
  credential: {
    tenantId: string;
    practitionerId: string;
    serviceTypeId: string;
    certification: string;
    validFrom: string;
    validTo: string | null;
    canExecuteSession?: boolean;
    canSignReport?: boolean;
  },
): Promise<void> {
  await client.query(
    'insert into credential (tenant_id, practitioner_id, service_type_id, certification, ' +
      'valid_from, valid_to, can_execute_session, can_sign_report) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      credential.tenantId,
      credential.practitionerId,
      credential.serviceTypeId,
      credential.certification,
      credential.validFrom,
      credential.validTo,
      credential.canExecuteSession ?? false,
      credential.canSignReport ?? false,
    ],
  );
}
