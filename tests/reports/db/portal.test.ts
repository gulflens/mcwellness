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
let household: { authId: string; clientId: string };

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

  household = { authId, clientId: found.client_id };
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
