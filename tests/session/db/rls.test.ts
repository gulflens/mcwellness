import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  MORE_IDS,
  asApiRole,
  count,
  freshDatabase,
  rejectsWith,
  seedClient,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';

const RLS_VIOLATION = '42501';

// A second practitioner under tenant A, distinct from MORE_IDS.practitionerA,
// so the deny cases have someone else's row to be denied.
const PRACTITIONER_B_USER = '00000000-0000-4000-8000-000000007001';
const PRACTITIONER_B = '00000000-0000-4000-8000-000000007002';

const SESSION_A = '00000000-0000-4000-8000-000000008001'; // practitioner A, tenant A
const SESSION_B = '00000000-0000-4000-8000-000000008002'; // practitioner B, tenant A
const SESSION_FOREIGN = '00000000-0000-4000-8000-000000008003'; // tenant B

const EVENT_A = '00000000-0000-4000-8000-000000009001';
const EVENT_B = '00000000-0000-4000-8000-000000009002';
const EVENT_FOREIGN = '00000000-0000-4000-8000-000000009003';

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await seedClient(client, IDS.tenantB, IDS.clientB, IDS.ownerB, 'Beta');
  // One service type row is enough: the foreign-tenant session below only
  // needs its service_type_id to reference an existing row (the foreign key
  // does not itself check tenant membership — that is what this file tests).
  await seedServiceType(client, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');

  await seedUser(client, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner A',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);

  await seedUser(client, {
    id: PRACTITIONER_B_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner B',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantA, PRACTITIONER_B, PRACTITIONER_B_USER);

  await client.query('begin');

  // Handcrafted rows, as the table owner, bypassing RLS: one session (and
  // one matching event) per practitioner in tenant A, and one in tenant B.
  const session = async (id: string, tenantId: string, clientId: string, practitionerId: string) =>
    client.query(
      'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, checked_in_at) ' +
        'values ($1, $2, $3, $4, $5, now())',
      [id, tenantId, clientId, practitionerId, MORE_IDS.serviceTypeA],
    );
  const event = async (
    id: string,
    tenantId: string,
    sessionId: string,
    clientId: string,
    practitionerId: string,
  ) =>
    client.query(
      'insert into session_event (id, tenant_id, session_id, client_id, practitioner_id, seq, kind, device_at) ' +
        "values ($1, $2, $3, $4, $5, 1, 'session_started', now())",
      [id, tenantId, sessionId, clientId, practitionerId],
    );

  await session(SESSION_A, IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA);
  await event(EVENT_A, IDS.tenantA, SESSION_A, IDS.clientA, MORE_IDS.practitionerA);
  await session(SESSION_B, IDS.tenantA, IDS.clientA, PRACTITIONER_B);
  await event(EVENT_B, IDS.tenantA, SESSION_B, IDS.clientA, PRACTITIONER_B);
  await session(SESSION_FOREIGN, IDS.tenantB, IDS.clientB, MORE_IDS.practitionerA);
  await event(EVENT_FOREIGN, IDS.tenantB, SESSION_FOREIGN, IDS.clientB, MORE_IDS.practitionerA);
});

afterAll(async () => {
  await client.query('rollback');
  await client.end();
});

/** Runs `fn` as the given practitioner's own user, inside asApiRole's savepoint. */
async function asPractitioner<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return asApiRole(
    client,
    IDS.tenantA,
    async () => {
      await client.query("select set_config('app.actor_id', $1, true)", [userId]);
      return fn();
    },
    'practitioner',
  );
}

describe('tenant isolation on session and session_event', () => {
  it('shows the owner every tenant', async () => {
    expect(await count(client, 'session')).toBe(3);
    expect(await count(client, 'session_event')).toBe(3);
  });

  it('shows the API role only its own tenant', async () => {
    await asApiRole(client, IDS.tenantA, async () => {
      const rows = await client.query<{ id: string }>('select id from session order by id');
      expect(rows.rows.map((r) => r.id)).toEqual([SESSION_A, SESSION_B]);
      expect(await count(client, 'session_event')).toBe(2);
    });
    await asApiRole(client, IDS.tenantB, async () => {
      const rows = await client.query<{ id: string }>('select id from session');
      expect(rows.rows).toEqual([{ id: SESSION_FOREIGN }]);
    });
  });

  it('refuses a row written for another tenant', async () => {
    await asApiRole(client, IDS.tenantA, async () => {
      await rejectsWith(
        client,
        RLS_VIOLATION,
        'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, checked_in_at) ' +
          'values (gen_random_uuid(), $1, $2, $3, $4, now())',
        [IDS.tenantB, IDS.clientA, MORE_IDS.practitionerA, MORE_IDS.serviceTypeA],
      );
    });
  });
});

describe('practitioner scope on session and session_event', () => {
  it('lets an oversight role see every session in the tenant', async () => {
    for (const role of ['owner', 'admin', 'lead_practitioner']) {
      await asApiRole(
        client,
        IDS.tenantA,
        async () => {
          expect(await count(client, 'session')).toBe(2);
          expect(await count(client, 'session_event')).toBe(2);
        },
        role,
      );
    }
  });

  it('scopes a practitioner to their own assigned sessions, on both tables', async () => {
    await asPractitioner(MORE_IDS.practitionerUserA, async () => {
      const sessions = await client.query<{ id: string }>('select id from session');
      expect(sessions.rows).toEqual([{ id: SESSION_A }]);
      const events = await client.query<{ id: string }>('select id from session_event');
      expect(events.rows).toEqual([{ id: EVENT_A }]);
    });
    await asPractitioner(PRACTITIONER_B_USER, async () => {
      const sessions = await client.query<{ id: string }>('select id from session');
      expect(sessions.rows).toEqual([{ id: SESSION_B }]);
    });
  });

  it("hides another practitioner's session from an update, affecting no rows", async () => {
    await asPractitioner(MORE_IDS.practitionerUserA, async () => {
      const result = await client.query('update session set status = $1 where id = $2', [
        'aborted',
        SESSION_B,
      ]);
      expect(result.rowCount).toBe(0);
    });
    // Unchanged: the owner connection still sees the original status.
    const row = await client.query<{ status: string }>('select status from session where id = $1', [
      SESSION_B,
    ]);
    expect(row.rows[0]?.status).toBe('in_progress');
  });

  it('refuses a practitioner inserting a session attributed to someone else', async () => {
    await asPractitioner(MORE_IDS.practitionerUserA, async () => {
      await rejectsWith(
        client,
        RLS_VIOLATION,
        'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, checked_in_at) ' +
          'values (gen_random_uuid(), $1, $2, $3, $4, now())',
        [IDS.tenantA, IDS.clientA, PRACTITIONER_B, MORE_IDS.serviceTypeA],
      );
    });
  });
});
