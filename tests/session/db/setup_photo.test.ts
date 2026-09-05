import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
  setAuditContext,
} from '../../db/helpers';
import { seedConsent, seedConsentDocument } from './helpers';

/**
 * The doors the setup photograph goes through
 * (db/migrations/306_kit_and_setup_photo.sql, docs/SPEC/practitioner-phone.md
 * section 4).
 *
 * Three of them, and each is a hole in a wall by construction, so each is
 * tested for what it refuses rather than only for what it answers:
 *
 *  * `app.setup_photo_consent_active`, which unlike 304's own consent door
 *    still answers after the visit has closed — because the bytes travel after
 *    their event and an offline day may close the visit first (decision 4) —
 *    and which is still bound to the caller's own visit and the practice's own
 *    record of who may agree on a child's behalf;
 *  * `app.file_setup_photo_document`, which files the one `document` row a
 *    practitioner may file at all, and refuses a second, another kind, another
 *    practitioner's visit and a household that has not agreed;
 *  * `app.file_setup_photo`, which sets the link — and the close guard, which
 *    admits exactly that one change on a frozen visit and goes on refusing
 *    every other.
 *
 * Then the two paths that take a photograph away again: a withdrawal of
 * `photo_video`, and an erasure, both with a photograph filed first.
 */

const RESTRICT_VIOLATION = '23001';
const SERVICE_TYPE = '00000000-0000-4000-8000-0000000000f4';

const CALLER_USER = '00000000-0000-4000-8000-000000501001';
const CALLER = '00000000-0000-4000-8000-000000501002';
const OTHER_USER = '00000000-0000-4000-8000-000000501003';
const OTHER = '00000000-0000-4000-8000-000000501004';

const ADULT = '00000000-0000-4000-8000-000000502001';
const REFUSER = '00000000-0000-4000-8000-000000502002';
const LOCATION_A = '00000000-0000-4000-8000-000000503001';
const LOCATION_B = '00000000-0000-4000-8000-000000503002';
const CONTACT_ADULT = '00000000-0000-4000-8000-000000504001';
const CONTACT_REFUSER = '00000000-0000-4000-8000-000000504002';
const WORDING = '00000000-0000-4000-8000-000000505001';
const CONSENT_PHOTO = '00000000-0000-4000-8000-000000506001';

const OPEN_VISIT = '00000000-0000-4000-8000-000000507001';
const CLOSED_VISIT = '00000000-0000-4000-8000-000000507002';
const OTHERS_VISIT = '00000000-0000-4000-8000-000000507003';
const REFUSED_VISIT = '00000000-0000-4000-8000-000000507004';

const ERASURE_REQUEST = '00000000-0000-4000-8000-000000508001';

/** A key made of ids alone, exactly as domain/shared/storage.ts builds one. */
function key(clientId: string, documentId: string): string {
  return `tenant/${IDS.tenantA}/client/${clientId}/${documentId}`;
}

let client: pg.Client;

async function seedSession(session: {
  id: string;
  clientId: string;
  practitionerId: string;
  locationId: string;
  closed?: boolean;
}): Promise<void> {
  await client.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'delivery_mode, location_id, checked_in_at, status, closed_at, closed_by, created_by) ' +
      "values ($1, $2, $3, $4, $5, 'home', $6, now(), $7, $8, $9, $10)",
    [
      session.id,
      IDS.tenantA,
      session.clientId,
      session.practitionerId,
      SERVICE_TYPE,
      session.locationId,
      session.closed ? 'completed' : 'in_progress',
      session.closed ? new Date().toISOString() : null,
      session.closed ? CALLER_USER : null,
      CALLER_USER,
    ],
  );
}

/**
 * Stamps the transaction as this practitioner, without switching role.
 *
 * The three functions under test are security definer and read
 * `app.actor_id`, `app.tenant_id` and `app.actor_roles` straight from the
 * transaction's own settings, so no role switch is needed — and their effects
 * survive for the assertions afterwards, which the savepoint inside
 * `asApiRole` would otherwise roll back (the same reasoning
 * tests/portal/db/policies.test.ts records for app.erase_client). Where a
 * refusal by row security is the thing under test, `asApiRole` is used
 * instead, and the assertion sits inside it.
 */
async function actingAs(userId: string, roles = 'practitioner'): Promise<void> {
  await client.query(
    "select set_config('app.actor_id', $1, true), set_config('app.tenant_id', $2, true), " +
      "set_config('app.actor_roles', $3, true), set_config('app.request_id', $4, true), " +
      "set_config('app.reason', $5, true)",
    [userId, IDS.tenantA, roles, IDS.request, 'A synthetic filing.'],
  );
}

/** Both halves of the filing, as the route runs them: the row, then the link. */
async function fileFor(
  sessionId: string,
  clientId: string,
  documentId = randomUUID(),
): Promise<{ documentId: string; filed: boolean; linked: boolean }> {
  const filed = await client.query<{ filed: boolean }>(
    'select app.file_setup_photo_document($1, $2, $3, $4, $5, $6) as filed',
    [sessionId, documentId, key(clientId, documentId), 'image/jpeg', Buffer.alloc(32, 3), null],
  );
  if (filed.rows[0]?.filed !== true) {
    return { documentId, filed: false, linked: false };
  }
  const linked = await client.query<{ linked: boolean }>(
    'select app.file_setup_photo($1, $2) as linked',
    [sessionId, documentId],
  );
  return { documentId, filed: true, linked: linked.rows[0]?.linked === true };
}

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedServiceType(client, IDS.tenantA, SERVICE_TYPE, 'nf-session');
  await seedConsentDocument(client, IDS.tenantA, WORDING);

  for (const [userId, practitionerId] of [
    [CALLER_USER, CALLER],
    [OTHER_USER, OTHER],
  ] as const) {
    await seedUser(client, {
      id: userId,
      tenantId: IDS.tenantA,
      authId: userId,
      displayName: 'Synthetic Practitioner',
      roles: ['practitioner'],
    });
    await seedPractitioner(client, IDS.tenantA, practitionerId, userId);
  }

  await seedClient(client, IDS.tenantA, ADULT, IDS.ownerA, 'Harbour');
  await seedClient(client, IDS.tenantA, REFUSER, IDS.ownerA, 'Lagoon');
  await client.query("update client set date_of_birth = '1990-01-01' where id = any($1)", [
    [ADULT, REFUSER],
  ]);
  await seedLocation(client, IDS.tenantA, LOCATION_A, ADULT, IDS.ownerA);
  await seedLocation(client, IDS.tenantA, LOCATION_B, REFUSER, IDS.ownerA);

  for (const [contactId, clientId] of [
    [CONTACT_ADULT, ADULT],
    [CONTACT_REFUSER, REFUSER],
  ] as const) {
    await client.query(
      'insert into contact (id, tenant_id, client_id, relationship, can_consent) ' +
        "values ($1, $2, $3, 'mother', true)",
      [contactId, IDS.tenantA, clientId],
    );
  }

  // One household has agreed to photographs; the other has not been asked.
  await seedConsent(client, {
    id: CONSENT_PHOTO,
    tenantId: IDS.tenantA,
    clientId: ADULT,
    givenByContactId: CONTACT_ADULT,
    purpose: 'photo_video' as 'participation',
    textDocumentId: WORDING,
  });
});

afterAll(async () => {
  await client.end();
});

describe('the consent door, after the visit has closed', () => {
  it('answers for an open visit and for one already closed', async () => {
    await rolledBack(client, async () => {
      await seedSession({
        id: OPEN_VISIT,
        clientId: ADULT,
        practitionerId: CALLER,
        locationId: LOCATION_A,
      });
      await seedSession({
        id: CLOSED_VISIT,
        clientId: ADULT,
        practitionerId: OTHER,
        locationId: LOCATION_A,
        closed: true,
      });
      await actingAs(CALLER_USER);
      const open = await client.query<{ active: boolean }>(
        'select app.setup_photo_consent_active($1) as active',
        [OPEN_VISIT],
      );
      expect(open.rows[0]?.active).toBe(true);
      await actingAs(OTHER_USER);
      const closed = await client.query<{ active: boolean }>(
        'select app.setup_photo_consent_active($1) as active',
        [CLOSED_VISIT],
      );
      // 304's own door would answer false here, deliberately. This one must
      // not: the bytes arrive after the close, and refusing them would drop a
      // photograph the household agreed to.
      expect(closed.rows[0]?.active).toBe(true);
    });
  });

  it("answers false for another practitioner's visit", async () => {
    await rolledBack(client, async () => {
      await seedSession({
        id: OTHERS_VISIT,
        clientId: ADULT,
        practitionerId: OTHER,
        locationId: LOCATION_A,
      });
      await actingAs(CALLER_USER);
      const { rows } = await client.query<{ active: boolean }>(
        'select app.setup_photo_consent_active($1) as active',
        [OTHERS_VISIT],
      );
      expect(rows[0]?.active).toBe(false);
    });
  });

  it('answers false for a household that has not agreed', async () => {
    await rolledBack(client, async () => {
      await seedSession({
        id: REFUSED_VISIT,
        clientId: REFUSER,
        practitionerId: CALLER,
        locationId: LOCATION_B,
      });
      await actingAs(CALLER_USER);
      const { rows } = await client.query<{ active: boolean }>(
        'select app.setup_photo_consent_active($1) as active',
        [REFUSED_VISIT],
      );
      expect(rows[0]?.active).toBe(false);
    });
  });

  it('answers false once the consent is withdrawn', async () => {
    await rolledBack(client, async () => {
      await seedSession({
        id: OPEN_VISIT,
        clientId: ADULT,
        practitionerId: CALLER,
        locationId: LOCATION_A,
      });
      await client.query(
        "update consent set status = 'withdrawn', withdrawn_at = now() where id = $1",
        [CONSENT_PHOTO],
      );
      await actingAs(CALLER_USER);
      const { rows } = await client.query<{ active: boolean }>(
        'select app.setup_photo_consent_active($1) as active',
        [OPEN_VISIT],
      );
      expect(rows[0]?.active).toBe(false);
    });
  });
});

describe('filing the photograph', () => {
  it('files the row and the link on an open visit', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, CALLER_USER, 'A synthetic filing.');
      await seedSession({
        id: OPEN_VISIT,
        clientId: ADULT,
        practitionerId: CALLER,
        locationId: LOCATION_A,
      });
      await actingAs(CALLER_USER);
      const outcome = await fileFor(OPEN_VISIT, ADULT);
      expect(outcome).toMatchObject({ filed: true, linked: true });

      const { rows } = await client.query<{
        kind: string;
        is_immutable: boolean;
        client_id: string;
        linked: string | null;
      }>(
        'select d.kind, d.is_immutable, d.client_id, s.setup_photo_document_id as linked ' +
          'from document d, session s where d.id = $1 and s.id = $2',
        [outcome.documentId, OPEN_VISIT],
      );
      expect(rows[0]?.kind).toBe('setup_photo');
      expect(rows[0]?.is_immutable).toBe(true);
      expect(rows[0]?.client_id).toBe(ADULT);
      expect(rows[0]?.linked).toBe(outcome.documentId);
    });
  });

  it('files on a visit that has already closed, which is the whole point', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, CALLER_USER, 'A synthetic late filing.');
      await seedSession({
        id: CLOSED_VISIT,
        clientId: ADULT,
        practitionerId: CALLER,
        locationId: LOCATION_A,
        closed: true,
      });
      await actingAs(CALLER_USER);
      const outcome = await fileFor(CLOSED_VISIT, ADULT);
      expect(outcome).toMatchObject({ filed: true, linked: true });
      const { rows } = await client.query<{ linked: string | null }>(
        'select setup_photo_document_id as linked from session where id = $1',
        [CLOSED_VISIT],
      );
      expect(rows[0]?.linked).toBe(outcome.documentId);
    });
  });

  it('refuses a second photograph on a visit that already has one', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, CALLER_USER, 'A synthetic filing.');
      await seedSession({
        id: OPEN_VISIT,
        clientId: ADULT,
        practitionerId: CALLER,
        locationId: LOCATION_A,
      });
      await actingAs(CALLER_USER);
      expect(await fileFor(OPEN_VISIT, ADULT)).toMatchObject({ filed: true, linked: true });
      expect(await fileFor(OPEN_VISIT, ADULT)).toMatchObject({ filed: false });
    });
  });

  it("refuses another practitioner's visit and a household that has not agreed", async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, CALLER_USER, 'A synthetic filing.');
      await seedSession({
        id: OTHERS_VISIT,
        clientId: ADULT,
        practitionerId: OTHER,
        locationId: LOCATION_A,
      });
      await seedSession({
        id: REFUSED_VISIT,
        clientId: REFUSER,
        practitionerId: CALLER,
        locationId: LOCATION_B,
      });
      await actingAs(CALLER_USER);
      expect(await fileFor(OTHERS_VISIT, ADULT)).toMatchObject({ filed: false });
      expect(await fileFor(REFUSED_VISIT, REFUSER)).toMatchObject({ filed: false });
    });
  });

  it('refuses anything that is not an image', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, CALLER_USER, 'A synthetic filing.');
      await seedSession({
        id: OPEN_VISIT,
        clientId: ADULT,
        practitionerId: CALLER,
        locationId: LOCATION_A,
      });
      await actingAs(CALLER_USER);
      const documentId = randomUUID();
      await rejectsWith(
        client,
        '23514',
        'select app.file_setup_photo_document($1, $2, $3, $4, $5, $6)',
        [
          OPEN_VISIT,
          documentId,
          key(ADULT, documentId),
          'application/pdf',
          Buffer.alloc(32, 3),
          null,
        ],
      );
    });
  });

  it('refuses a practitioner filing a client document any other way', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, CALLER_USER, 'A synthetic filing.');
      // The one place the API role itself is used, because a refusal by row
      // security is what is under test.
      await asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [CALLER_USER]);
          const documentId = randomUUID();
          // The door exists because db/policies/client/writers.sql refuses this
          // outright: a practitioner does not file documents, and the definer
          // function is the one narrow exception rather than a widening.
          await rejectsWith(
            client,
            '42501',
            'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
              "values ($1, $2, $3, 'setup_photo', $4, 'image/jpeg', $5)",
            [documentId, IDS.tenantA, ADULT, key(ADULT, documentId), Buffer.alloc(32, 3)],
          );
        },
        'practitioner',
      );
    });
  });
});

describe('the close guard, with the one exception', () => {
  it('still refuses every other change to a closed visit', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, CALLER_USER, 'A synthetic change.');
      await seedSession({
        id: CLOSED_VISIT,
        clientId: ADULT,
        practitionerId: CALLER,
        locationId: LOCATION_A,
        closed: true,
      });
      await rejectsWith(
        client,
        RESTRICT_VIOLATION,
        "update session set observations = '{}'::jsonb where id = $1",
        [CLOSED_VISIT],
      );
      await rejectsWith(
        client,
        RESTRICT_VIOLATION,
        'update session set signal_quality_score = 0.5 where id = $1',
        [CLOSED_VISIT],
      );
    });
  });

  it('refuses the photograph link set by anything but the door', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, CALLER_USER, 'A synthetic filing.');
      await seedSession({
        id: OPEN_VISIT,
        clientId: ADULT,
        practitionerId: CALLER,
        locationId: LOCATION_A,
      });
      const documentId = randomUUID();
      await actingAs(CALLER_USER);
      const filed = await client.query<{ filed: boolean }>(
        'select app.file_setup_photo_document($1, $2, $3, $4, $5, $6) as filed',
        [OPEN_VISIT, documentId, key(ADULT, documentId), 'image/jpeg', Buffer.alloc(32, 3), null],
      );
      expect(filed.rows[0]?.filed).toBe(true);
      // Now close the visit, and try the link as a plain update.
      await client.query(
        "update session set status = 'completed', closed_at = now() where id = $1",
        [OPEN_VISIT],
      );
      await rejectsWith(
        client,
        RESTRICT_VIOLATION,
        'update session set setup_photo_document_id = $1 where id = $2',
        [documentId, OPEN_VISIT],
      );
      // The door itself still works on the same row.
      await actingAs(CALLER_USER);
      const linked = await client.query<{ linked: boolean }>(
        'select app.file_setup_photo($1, $2) as linked',
        [OPEN_VISIT, documentId],
      );
      expect(linked.rows[0]?.linked).toBe(true);
    });
  });

  it('grants app_role nothing on the marker the guard reads', async () => {
    const { rows } = await client.query<{ n: string }>(
      'select count(*)::text as n from information_schema.role_table_grants ' +
        "where table_schema = 'app' and table_name = 'setup_photo_filing' " +
        "and grantee = 'app_role'",
    );
    expect(rows[0]?.n).toBe('0');
  });
});

describe('taking a photograph away again', () => {
  it('leaves a withdrawal able to find every photograph on the record', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, CALLER_USER, 'A synthetic filing.');
      await seedSession({
        id: OPEN_VISIT,
        clientId: ADULT,
        practitionerId: CALLER,
        locationId: LOCATION_A,
      });
      await actingAs(CALLER_USER);
      const outcome = await fileFor(OPEN_VISIT, ADULT);
      expect(outcome.filed).toBe(true);

      await client.query(
        "update consent set status = 'withdrawn', withdrawn_at = now() where id = $1",
        [CONSENT_PHOTO],
      );
      // Exactly the two queries app/api/clients/withdrawal.ts makes.
      const stillPermitted = await client.query<{ n: string }>(
        "select count(*)::text as n from consent where client_id = $1 and purpose = 'photo_video' " +
          "and status = 'active'",
        [ADULT],
      );
      expect(stillPermitted.rows[0]?.n).toBe('0');
      const toRemove = await client.query<{ id: string; storage_key: string }>(
        "select id, storage_key from document where client_id = $1 and kind = 'setup_photo'",
        [ADULT],
      );
      expect(toRemove.rows.map((row) => row.id)).toEqual([outcome.documentId]);
      expect(toRemove.rows[0]?.storage_key).toBe(key(ADULT, outcome.documentId));
    });
  });

  it('lets an erasure unlink the visit and delete the photograph', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, CALLER_USER, 'A synthetic filing.');
      await seedSession({
        id: CLOSED_VISIT,
        clientId: ADULT,
        practitionerId: CALLER,
        locationId: LOCATION_A,
        closed: true,
      });
      await actingAs(CALLER_USER);
      const outcome = await fileFor(CLOSED_VISIT, ADULT);
      expect(outcome).toMatchObject({ filed: true, linked: true });

      await setAuditContext(client, IDS.ownerA, 'A synthetic erasure, to prove the photo goes.');
      await client.query(
        'insert into erasure_request (id, tenant_id, client_id, reason) values ($1, $2, $3, $4)',
        [ERASURE_REQUEST, IDS.tenantA, ADULT, 'A synthetic erasure, for this test.'],
      );
      await client.query(
        "select set_config('app.tenant_id', $1, true), " +
          "set_config('app.actor_roles', 'owner', true)",
        [IDS.tenantA],
      );
      await client.query('select app.erase_client($1, $2)', [ADULT, ERASURE_REQUEST]);

      const session = await client.query<{ linked: string | null }>(
        'select setup_photo_document_id as linked from session where id = $1',
        [CLOSED_VISIT],
      );
      expect(session.rows[0]?.linked).toBeNull();
      const document = await client.query('select id from document where id = $1', [
        outcome.documentId,
      ]);
      expect(document.rowCount).toBe(0);
    });
  });
});
