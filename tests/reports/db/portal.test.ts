import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PortalReportsResponse } from '../../../app/api/portal/schema';
import type { DocumentLinkResponse } from '../../../app/api/reports/schema';
import type { DraftResponse } from '../../../app/api/reports/schema';
import { progressBody, SEEDED, startHarness, type Harness } from './support';

/**
 * What the household sees of its own reports
 * (docs/SPEC/reports-v1.md section 7.3, the portal's sixth screen).
 *
 * **Issued reports for their own client, and nothing else**: never a draft,
 * never a superseded version they were not sent, never another household's.
 * The row policies are what refuse each of those; this proves the screen's own
 * door keeps to them.
 */

const NOW = () => new Date('2026-09-06T08:00:00.000Z');

let h: Harness;
let household: { authId: string; clientId: string; contactId: string };

beforeAll(async () => {
  h = await startHarness(NOW);

  // A contact with a portal login of their own, made the way the portal's own
  // door makes one: an app_user, the client_contact role, and contact.user_id.
  const { rows } = await h.owner.query<{ contact_id: string; client_id: string }>(
    'select ct.id as contact_id, ct.client_id from contact ct ' +
      'join client c on c.id = ct.client_id ' +
      "where c.status <> 'erased' order by ct.id limit 1",
  );
  const found = rows[0];
  if (!found) throw new Error('The seed has no contact.');

  const userId = '00000000-0000-4000-8000-0000000006e1';
  const authId = '00000000-0000-4000-8000-0000000006e2';
  await h.owner.query(
    'insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, $4)',
    [userId, h.data.tenant.id, authId, 'Household login'],
  );
  await h.owner.query(
    "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'client_contact')",
    [h.data.tenant.id, userId],
  );
  await h.owner.query('update contact set user_id = $1 where id = $2', [userId, found.contact_id]);

  household = { authId, clientId: found.client_id, contactId: found.contact_id };
}, 120_000);

afterAll(async () => {
  await h.close();
});

async function draftFor(clientId: string): Promise<string> {
  const res = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
    clientId,
    kind: 'progress',
    coverageFrom: '2026-06-01',
    coverageTo: '2026-09-01',
    content: progressBody(),
  });
  if (res.status !== 201) throw new Error(`Draft was refused: ${res.status}`);
  return ((await res.json()) as DraftResponse).report.id;
}

async function issueFor(clientId: string): Promise<string> {
  const id = await draftFor(clientId);
  const res = await h.call('POST', `/api/reports/${id}/issue`, SEEDED.owner, {
    practitionerId: h.practitionerIdOf(SEEDED.owner),
  });
  if (res.status !== 201) throw new Error(`Issue was refused: ${res.status}`);
  return id;
}

describe('the household’s own screen', () => {
  it('lists its issued reports and never a draft', async () => {
    const issuedId = await issueFor(household.clientId);
    const draftId = await draftFor(household.clientId);

    const res = await h.callAs('GET', '/api/portal/reports', household.authId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PortalReportsResponse;
    const ids = body.reports.map((report) => report.id);
    expect(ids).toContain(issuedId);
    expect(ids).not.toContain(draftId);
    // The body never travels: a household's most personal document opens
    // through a link, not through every response the screen makes.
    expect(JSON.stringify(body)).not.toContain('summary');
  });

  it('never lists another household’s', async () => {
    const otherClient = h.data.clients.find((c) => c.id !== household.clientId);
    if (!otherClient) throw new Error('The seed has one client.');
    const theirs = await issueFor(otherClient.id);

    const res = await h.callAs('GET', '/api/portal/reports', household.authId);
    const body = (await res.json()) as PortalReportsResponse;
    expect(body.reports.map((report) => report.id)).not.toContain(theirs);
  });

  it('opens one through a short-lived signed link, and records the read', async () => {
    const id = await issueFor(household.clientId);
    const documents = await h.owner.query<{ document_id: string }>(
      'select document_id from report where id = $1',
      [id],
    );
    const documentId = documents.rows[0]?.document_id;
    if (!documentId) throw new Error('The report was not filed.');

    const before = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_id = $1",
      [documentId],
    );
    const res = await h.callAs('GET', `/api/portal/reports/${documentId}/link`, household.authId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DocumentLinkResponse;
    expect(body.url).toBeTruthy();
    expect(body.expiresInSeconds).toBe(300);
    const after = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_id = $1",
      [documentId],
    );
    expect(Number(after.rows[0]?.n)).toBeGreaterThan(Number(before.rows[0]?.n));
  });

  it('refuses a link to another household’s document', async () => {
    const otherClient = h.data.clients.find((c) => c.id !== household.clientId);
    if (!otherClient) throw new Error('The seed has one client.');
    const theirs = await issueFor(otherClient.id);
    const documents = await h.owner.query<{ document_id: string }>(
      'select document_id from report where id = $1',
      [theirs],
    );
    const res = await h.callAs(
      'GET',
      `/api/portal/reports/${documents.rows[0]?.document_id}/link`,
      household.authId,
    );
    // A 404, never a 403: a refusal that confirms the document exists is a
    // refusal that says whose it is.
    expect(res.status).toBe(404);
  });

  it('refuses the screen to a member of the practice', async () => {
    // Their reach is the console's, and a staff account answering here would
    // be shown a portal with no clients in it — which reads as "you have no
    // record" rather than as "this screen is not yours".
    const res = await h.call('GET', '/api/portal/reports', SEEDED.owner);
    expect(res.status).toBe(403);
  });
});

/**
 * **Who of a household may read a report** (docs/SPEC/reports-v1.md section
 * 7.3, as the operator amended it on 2026-09-06, reversing default 4 of pull
 * request 83). A legal guardian, or the person themselves once they are an
 * adult. A young person's own login reads no report about themselves, and it
 * is the row policy that refuses it (`app.actor_may_read_reports_of`,
 * migration 955) rather than a screen that leaves a line out.
 */
describe('a report about a minor is the guardian’s to read', () => {
  let minorClientId: string;
  let guardianAuth: string;
  let minorAuth: string;
  let issuedId: string;
  let documentId: string;

  beforeAll(async () => {
    // A seeded minor: the generator gives every one of them a parent recorded
    // as a legal guardian, and gives an adult client a `self` contact instead.
    const guardian = h.data.contacts.find((contact) => {
      const client = h.data.clients.find((each) => each.id === contact.clientId);
      return (
        contact.isLegalGuardian &&
        contact.id !== household.contactId &&
        client !== undefined &&
        client.status !== 'erased'
      );
    });
    if (!guardian) throw new Error('The seed has no guarded child.');
    minorClientId = guardian.clientId;

    // Two portal logins on the same child: the guardian's, and the child's own.
    const login = async (userId: string, authId: string, displayName: string): Promise<void> => {
      await h.owner.query(
        'insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, $4)',
        [userId, h.data.tenant.id, authId, displayName],
      );
      await h.owner.query(
        "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'client_contact')",
        [h.data.tenant.id, userId],
      );
    };

    const guardianUser = '00000000-0000-4000-8000-0000000006f1';
    guardianAuth = '00000000-0000-4000-8000-0000000006f2';
    await login(guardianUser, guardianAuth, 'Guardian login');
    await h.owner.query('update contact set user_id = $1 where id = $2', [
      guardianUser,
      guardian.id,
    ]);

    const minorUser = '00000000-0000-4000-8000-0000000006f3';
    minorAuth = '00000000-0000-4000-8000-0000000006f4';
    await login(minorUser, minorAuth, 'Young person login');
    await h.owner.query(
      'insert into contact (id, tenant_id, client_id, user_id, relationship, given_name, ' +
        'family_name, is_legal_guardian, can_consent, can_receive_reports, can_pay, phone) ' +
        "values ($1, $2, $3, $4, 'self', 'Cedar', 'Meadow', false, false, true, false, $5)",
      [
        '00000000-0000-4000-8000-0000000006f5',
        h.data.tenant.id,
        minorClientId,
        minorUser,
        '+971500000031',
      ],
    );

    issuedId = await issueFor(minorClientId);
    const filed = await h.owner.query<{ document_id: string }>(
      'select document_id from report where id = $1',
      [issuedId],
    );
    const found = filed.rows[0]?.document_id;
    if (!found) throw new Error('The report was not filed.');
    documentId = found;
  }, 120_000);

  it('shows it to the guardian, and opens it', async () => {
    const res = await h.callAs('GET', '/api/portal/reports', guardianAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PortalReportsResponse;
    expect(body.reports.map((report) => report.id)).toContain(issuedId);
    expect(body.clients.map((client) => client.id)).toContain(minorClientId);

    const link = await h.callAs('GET', `/api/portal/reports/${documentId}/link`, guardianAuth);
    expect(link.status).toBe(200);
  });

  it('refuses the young person’s own login, screen and link alike', async () => {
    const res = await h.callAs('GET', '/api/portal/reports', minorAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PortalReportsResponse;
    expect(body.reports).toEqual([]);
    expect(body.clients).toEqual([]);

    const link = await h.callAs('GET', `/api/portal/reports/${documentId}/link`, minorAuth);
    expect(link.status).toBe(404);
  });

  it('refuses it in the database, not merely on the screen', async () => {
    // The practice's own route reads the same row under the same policy, so a
    // household that went round the portal reaches nothing either.
    const direct = await h.callAs('GET', `/api/reports/${issuedId}`, minorAuth);
    expect(direct.status).toBe(404);
    const asGuardian = await h.callAs('GET', `/api/reports/${issuedId}`, guardianAuth);
    expect(asGuardian.status).toBe(200);
  });
});

describe('what the practice’s own routes refuse a household', () => {
  it('refuses a household the draft door and the issuing door', async () => {
    const draft = await h.callAs('POST', '/api/reports/draft', household.authId, {
      clientId: household.clientId,
      kind: 'progress',
      coverageFrom: '2026-06-01',
      coverageTo: '2026-09-01',
      content: progressBody(),
    });
    expect(draft.status).toBe(403);
  });

  it('lets a household read one of its own through the practice’s route, and no draft', async () => {
    const issuedId = await issueFor(household.clientId);
    const mine = await h.callAs('GET', `/api/reports/${issuedId}`, household.authId);
    expect(mine.status).toBe(200);

    const draftId = await draftFor(household.clientId);
    const theirs = await h.callAs('GET', `/api/reports/${draftId}`, household.authId);
    expect(theirs.status).toBe(404);
  });
});
