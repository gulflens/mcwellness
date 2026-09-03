import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedContact,
  seedLocation,
  seedTenant,
  setAuditContext,
} from '../../db/helpers';

/**
 * app.erase_client (db/migrations/100_client_record.sql), end to end, on a
 * seeded synthetic client: docs/SPEC/client-record.md section 8, steps 1
 * to 4, in one call.
 *
 * Deliberately not asApiRole (tests/db/helpers.ts): that helper rolls back
 * to its own savepoint once its callback returns, which is exactly right for
 * proving a deny case but wrong here — an erasure's effects need to survive
 * long enough for the assertions after it to see them. app.erase_client is
 * security definer and checks app.actor_has_role/app.current_tenant_id
 * directly, so setting those two transaction-local settings by hand is
 * enough; no role switch is needed to call it.
 */

const PORTAL_USER = '00000000-0000-4000-8000-0000000000f9';
const DOCUMENT = '00000000-0000-4000-8000-0000000000fa';
const ERASURE_REQUEST = '00000000-0000-4000-8000-0000000000fb';
const PRACTICE_DOCUMENT = '00000000-0000-4000-8000-0000000000fc';
const SIGNATURE_DOCUMENT = '00000000-0000-4000-8000-0000000000fd';
const CONSENT = '00000000-0000-4000-8000-0000000000fe';
const GOAL = '00000000-0000-4000-8000-000000000100';
const MISMATCHED_ERASURE_REQUEST = '00000000-0000-4000-8000-000000000101';

let owner: pg.Client;
let goalCategoryId: string;

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await owner.query(
    "update client set given_name_ar = 'ألفا', family_name_ar = 'سينثتيك', date_of_birth = '2010-05-01', " +
      "sex_at_birth = 'male', referral_source = 'website', status = 'active' where id = $1",
    [IDS.clientA],
  );
  await seedContact(owner, IDS.tenantA, IDS.contactA, IDS.clientA, 'x-erase-test-1');
  // The four name columns migration 101 added, set here rather than in
  // seedContact: tests/db/helpers.ts is the shared zone, and a contact known
  // only by its relationship is still the ordinary case everywhere else.
  // Migration 102 exists to clear these, so the fixture has to carry them.
  await owner.query(
    "update contact set given_name = 'Willow', family_name = 'Meadow', " +
      "given_name_ar = 'صفصاف', family_name_ar = 'مرج' where id = $1",
    [IDS.contactA],
  );
  await owner.query(
    "insert into app_user (id, tenant_id, display_name, status) values ($1, $2, 'Household Portal', 'active')",
    [PORTAL_USER, IDS.tenantA],
  );
  await owner.query('update contact set user_id = $1 where id = $2', [PORTAL_USER, IDS.contactA]);
  await seedLocation(owner, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);
  // app.guard_location_notes() (100_client_record.sql) restricts an update to
  // access_notes alone unless the actor holds owner, admin or lead_practitioner
  // (by app.actor_roles, not by connection identity — the trigger fires for
  // every writer, table owner included); this fixture update touches several
  // columns, so it declares itself as the owner first, in the same
  // transaction: app.actor_roles is transaction-local (set_config(..., true))
  // and would not otherwise survive to the next statement.
  await owner.query('begin');
  await owner.query("select set_config('app.actor_roles', 'owner', true)");
  await owner.query(
    "update location set makani_number = '0012345678', display_address = 'Villa 9', " +
      "access_notes = 'Ring twice', parking_point = extensions.st_geogfromtext('SRID=4326;POINT(55.2705 25.2005)'), " +
      "community_gate = extensions.st_geogfromtext('SRID=4326;POINT(55.271 25.201)') where id = $1",
    [IDS.locationA],
  );
  await owner.query('commit');
  await owner.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
      "values ($1, $2, $3, 'setup_photo', 'erase-test/photo.jpg', 'image/jpeg', sha256('x'::bytea))",
    [DOCUMENT, IDS.tenantA, IDS.clientA],
  );

  // A practice document (client_id null) for a consent's text_document_id — the wording
  // shown, never deleted by an erasure that is never about it — and a client-owned
  // document for the signature itself (method app_signature), which the delete in step 6
  // would otherwise abort on: consent.signature_document_id still names it (issue 1).
  await owner.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
      "values ($1, $2, null, 'consent_wording', 'erase-test/wording.pdf', 'application/pdf', sha256('w'::bytea))",
    [PRACTICE_DOCUMENT, IDS.tenantA],
  );
  await owner.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
      "values ($1, $2, $3, 'signed_consent', 'erase-test/signature.png', 'image/png', sha256('s'::bytea))",
    [SIGNATURE_DOCUMENT, IDS.tenantA, IDS.clientA],
  );
  await owner.query(
    'insert into consent (id, tenant_id, client_id, given_by_contact_id, purpose, version, ' +
      'text_document_id, method, signature_document_id) ' +
      "values ($1, $2, $3, $4, 'participation', 1, $5, 'app_signature', $6)",
    [CONSENT, IDS.tenantA, IDS.clientA, IDS.contactA, PRACTICE_DOCUMENT, SIGNATURE_DOCUMENT],
  );

  // A goal (client-record.md section 4.2; issue 3): description is free text and must be
  // cleared; status and category are structured, not personal data on their own, and stay.
  const focus = await owner.query<{ id: string }>(
    "select id from goal_category where tenant_id = $1 and code = 'focus'",
    [IDS.tenantA],
  );
  goalCategoryId = focus.rows[0]?.id ?? '';
  if (!goalCategoryId) throw new Error('seedTenant did not seed the "focus" goal category.');
  await owner.query(
    'insert into goal (id, tenant_id, client_id, category_id, description, status, is_primary) ' +
      "values ($1, $2, $3, $4, $5, 'active', true)",
    [GOAL, IDS.tenantA, IDS.clientA, goalCategoryId, 'Feels overwhelmed before school'],
  );
});

afterAll(async () => {
  await owner.end();
});

/** app.erase_client needs only these two transaction-local settings, not a role switch. */
async function actAs(roles: string): Promise<void> {
  await owner.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', $2, true)",
    [IDS.tenantA, roles],
  );
}

async function insertErasureRequest(reason: string): Promise<void> {
  await owner.query(
    'insert into erasure_request (id, tenant_id, client_id, reason) values ($1, $2, $3, $4)',
    [ERASURE_REQUEST, IDS.tenantA, IDS.clientA, reason],
  );
}

describe('app.erase_client', () => {
  it('anonymises the client, contacts and locations, deletes documents, and closes the request', async () => {
    await rolledBack(owner, async () => {
      await insertErasureRequest('Household asked to be forgotten');
      await setAuditContext(owner, IDS.ownerA);
      await actAs('owner');
      const result = await owner.query('select app.erase_client($1, $2) as erase_client', [
        IDS.clientA,
        ERASURE_REQUEST,
      ]);
      const summary = result.rows[0]?.erase_client as Record<string, unknown>;
      expect(summary).toMatchObject({
        contactsAnonymised: 1,
        portalAccountsArchived: 1,
        locationsReduced: 1,
        goalsCleared: 1,
        consentsUnlinked: 1,
        // DOCUMENT and SIGNATURE_DOCUMENT, both client_id = clientA; PRACTICE_DOCUMENT
        // (client_id null, the consent wording) is never touched (issue 1, issue 2).
        documentsDeleted: 2,
      });
      const storageKeysToDelete = summary.storage_keys_to_delete as { id: string }[];
      expect(storageKeysToDelete).toHaveLength(2);
      expect(new Set(storageKeysToDelete.map((d) => d.id))).toEqual(
        new Set([DOCUMENT, SIGNATURE_DOCUMENT]),
      );

      const client = await owner.query(
        'select given_name, family_name, given_name_ar, family_name_ar, date_of_birth, ' +
          'sex_at_birth, referral_source, status from client where id = $1',
        [IDS.clientA],
      );
      expect(client.rows[0]).toMatchObject({
        given_name: 'Erased client',
        family_name: 'Erased client',
        given_name_ar: null,
        family_name_ar: null,
        date_of_birth: null,
        sex_at_birth: null,
        referral_source: null,
        status: 'erased',
      });

      const contact = await owner.query(
        'select phone, email, whatsapp_opt_in, emirates_id_encrypted, emirates_id_hash, user_id, ' +
          'given_name, family_name, given_name_ar, family_name_ar from contact where id = $1',
        [IDS.contactA],
      );
      expect(contact.rows[0]).toMatchObject({
        phone: null,
        email: null,
        whatsapp_opt_in: false,
        emirates_id_encrypted: null,
        emirates_id_hash: null,
        user_id: null,
        // Migration 102: nulled rather than given a placeholder, because a
        // contact's name is nullable by construction and what remains — the
        // relationship — is not personal data.
        given_name: null,
        family_name: null,
        given_name_ar: null,
        family_name_ar: null,
      });

      const portalUser = await owner.query(
        'select display_name, email, phone, auth_id, status from app_user where id = $1',
        [PORTAL_USER],
      );
      expect(portalUser.rows[0]).toMatchObject({
        display_name: 'Erased user',
        email: null,
        phone: null,
        auth_id: null,
        status: 'archived',
      });

      const location = await owner.query(
        'select makani_number, display_address, access_notes, parking_point, community_gate, ' +
          'extensions.st_x(entrance_point::extensions.geometry) as lng, ' +
          'extensions.st_y(entrance_point::extensions.geometry) as lat ' +
          'from location where id = $1',
        [IDS.locationA],
      );
      expect(location.rows[0]).toMatchObject({
        makani_number: null,
        display_address: null,
        access_notes: null,
        parking_point: null,
        community_gate: null,
      });
      expect(location.rows[0]?.lng).toBeCloseTo(55.27, 3);
      expect(location.rows[0]?.lat).toBeCloseTo(25.2, 3);

      const document = await owner.query('select id from document where id = $1', [DOCUMENT]);
      expect(document.rowCount).toBe(0);
      const signatureDocument = await owner.query('select id from document where id = $1', [
        SIGNATURE_DOCUMENT,
      ]);
      expect(signatureDocument.rowCount).toBe(0);
      // Never touched: client_id is null, the practice's own consent wording (issue 1).
      const practiceDocument = await owner.query('select id from document where id = $1', [
        PRACTICE_DOCUMENT,
      ]);
      expect(practiceDocument.rowCount).toBe(1);

      const consent = await owner.query(
        'select text_document_id, signature_document_id from consent where id = $1',
        [CONSENT],
      );
      expect(consent.rows[0]).toMatchObject({
        text_document_id: PRACTICE_DOCUMENT,
        signature_document_id: null,
      });

      const goal = await owner.query(
        'select description, status, category_id, is_primary from goal where id = $1',
        [GOAL],
      );
      expect(goal.rows[0]).toMatchObject({
        description: '',
        status: 'active',
        category_id: goalCategoryId,
        is_primary: true,
      });

      const request = await owner.query(
        'select performed_at, summary from erasure_request where id = $1',
        [ERASURE_REQUEST],
      );
      expect(request.rows[0]?.performed_at).not.toBeNull();
      expect(request.rows[0]?.summary).toMatchObject({ clientId: IDS.clientA });
    });
  });

  it('refuses a second erasure of an already-erased client', async () => {
    await rolledBack(owner, async () => {
      await insertErasureRequest('first');
      await setAuditContext(owner, IDS.ownerA);
      await actAs('owner');
      await owner.query('select app.erase_client($1, $2)', [IDS.clientA, ERASURE_REQUEST]);
      await expect(
        owner.query('select app.erase_client($1, $2)', [IDS.clientA, ERASURE_REQUEST]),
      ).rejects.toThrow(/already erased/);
    });
  });

  it('raises when the erasure request does not name this client, and erases nothing', async () => {
    await rolledBack(owner, async () => {
      // MISMATCHED_ERASURE_REQUEST names no row at all, so the final update inside
      // app.erase_client matches nothing; it raises rather than returning quietly, and
      // Postgres rolls the whole statement back with it — client, contacts, locations,
      // goals, consents and documents all as they were (issue 5).
      await setAuditContext(owner, IDS.ownerA);
      await actAs('owner');
      await rejectsWith(owner, 'P0002', 'select app.erase_client($1, $2)', [
        IDS.clientA,
        MISMATCHED_ERASURE_REQUEST,
      ]);

      const client = await owner.query<{ status: string; given_name: string }>(
        'select status, given_name from client where id = $1',
        [IDS.clientA],
      );
      expect(client.rows[0]?.status).not.toBe('erased');
      expect(client.rows[0]?.given_name).not.toBe('Erased client');

      const document = await owner.query('select id from document where id = $1', [DOCUMENT]);
      expect(document.rowCount).toBe(1);
    });
  });

  it('refuses anyone who is not the owner, an admin or the lead practitioner', async () => {
    await rolledBack(owner, async () => {
      await insertErasureRequest('attempt');
      await setAuditContext(owner, IDS.ownerA);
      await actAs('finance');
      await expect(
        owner.query('select app.erase_client($1, $2)', [IDS.clientA, ERASURE_REQUEST]),
      ).rejects.toThrow();
    });
  });

  it('withholds the values on every audited write it makes, and none after end_erasure', async () => {
    await rolledBack(owner, async () => {
      await insertErasureRequest('audited');
      await setAuditContext(owner, IDS.ownerA);
      await actAs('owner');
      await owner.query('select app.erase_client($1, $2)', [IDS.clientA, ERASURE_REQUEST]);

      // Written inside begin_erasure/end_erasure: every value withheld, only the keys survive.
      const clientRow = await owner.query<{ new_values: Record<string, string> }>(
        "select new_values from audit_log where entity_type = 'client' and entity_id = $1 " +
          "and action = 'update' order by id desc limit 1",
        [IDS.clientA],
      );
      const newValues = clientRow.rows[0]?.new_values;
      expect(newValues).toHaveProperty('given_name', '[withheld: erasure]');
      expect(newValues).toHaveProperty('status', '[withheld: erasure]');

      // Written after end_erasure: the summary is counts, not people, and reads normally.
      const requestRow = await owner.query<{ new_values: Record<string, unknown> }>(
        "select new_values from audit_log where entity_type = 'erasure_request' and entity_id = $1 " +
          "and action = 'update' order by id desc limit 1",
        [ERASURE_REQUEST],
      );
      expect(requestRow.rows[0]?.new_values?.summary).not.toBe('[withheld: erasure]');
      expect(requestRow.rows[0]?.new_values?.performed_at).not.toBe('[withheld: erasure]');
    });
  });

  it('leaves no mark for a later write in the same transaction when erasure fails', async () => {
    await rolledBack(owner, async () => {
      const missingClient = '00000000-0000-4000-8000-0000000000fe';
      await insertErasureRequest('will not be reached');
      await setAuditContext(owner, IDS.ownerA);
      await actAs('owner');
      // A plain "raise exception" carries the default PL/pgSQL SQLSTATE, P0001.
      // rejectsWith wraps the failing call in its own savepoint, so the
      // surrounding transaction — the one this test keeps using next — is
      // never left aborted by it.
      await rejectsWith(owner, 'P0001', 'select app.erase_client($1, $2)', [
        missingClient,
        ERASURE_REQUEST,
      ]);

      // Same transaction, right after the failed call: an ordinary write, ordinarily audited.
      await owner.query("update client set given_name = 'Still Alpha' where id = $1", [
        IDS.clientA,
      ]);
      const row = await owner.query<{ new_values: Record<string, string> }>(
        "select new_values from audit_log where entity_type = 'client' and entity_id = $1 " +
          "and action = 'update' order by id desc limit 1",
        [IDS.clientA],
      );
      expect(row.rows[0]?.new_values?.given_name).toBe('Still Alpha');
    });
  });
});
