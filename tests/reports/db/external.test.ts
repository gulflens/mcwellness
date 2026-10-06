import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PortalReportsResponse } from '../../../app/api/portal/schema';
import type {
  DeliverResponse,
  DocumentLinkResponse,
  ReportListResponse,
  ReportResponse,
  ReportRow,
} from '../../../app/api/reports/schema';
import { asApiRole, rejectsWith } from '../../db/helpers';
import { bearerFor, SEEDED, refusalsOnTrail, startHarness, type Harness } from './support';

/**
 * An uploaded report (docs/SPEC/reports-v1.md section 12; migrations 607 and
 * 608): a PDF the practice made in another tool, filed against a client,
 * opened by the practice, sent to the household and opened in the portal as
 * a report written here is.
 *
 * Proved twice, as the reports stream proves everything: at the row, where
 * the boundary is — the kind is admitted, an uploaded report is filed issued
 * and numbered and never signed, it cannot be changed afterwards, it cannot
 * be inserted by hand, an erasure takes its title and its file, another
 * practice cannot read it — and at the door the console and the portal use.
 *
 * The bytes are a synthetic few lines that begin as a PDF does; nothing here
 * is a person's.
 */

const NOW = () => new Date('2026-09-06T08:00:00.000Z');

let h: Harness;
/** A client with a live participation consent and a contact, so a report may be sent. */
let clientId = '';
let contactId = '';
/** A household login on that client: a legal guardian, the one household reader. */
const householdAuthId = '00000000-0000-4000-8000-0000000007e2';
/** Somebody who keeps the books and nothing else. */
const financeAuthId = '00000000-0000-4000-8000-0000000007e4';

let serial = 0;
/** A distinct synthetic PDF each time, so no two uploads share a fingerprint. */
function pdf(extra = ''): Uint8Array {
  serial += 1;
  return new TextEncoder().encode(`%PDF-1.7\n% synthetic ${serial}${extra}\n%%EOF\n`);
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

type Upload = {
  title?: string;
  reportDate?: string;
  contentType?: string;
  sha?: string;
  client?: string;
};

async function upload(user: number, bytes: Uint8Array, over: Upload = {}): Promise<Response> {
  const query = new URLSearchParams({
    clientId: over.client ?? clientId,
    reportDate: over.reportDate ?? '2026-09-01',
  });
  return h.raw('POST', `/api/reports/external?${query.toString()}`, user, bytes, {
    'content-type': over.contentType ?? 'application/pdf',
    'x-sha256': over.sha ?? digest(bytes),
    'x-report-title': encodeURIComponent(over.title ?? 'Brain map, initial'),
  });
}

async function uploaded(user = SEEDED.owner, over: Upload = {}): Promise<ReportRow> {
  const res = await upload(user, pdf(), over);
  if (res.status !== 201) throw new Error(`The upload was refused: ${res.status}`);
  return ((await res.json()) as { report: ReportRow }).report;
}

async function callWithToken(
  method: 'GET' | 'POST',
  path: string,
  authId: string,
  body?: unknown,
): Promise<Response> {
  return h.callAs(method, path, authId, body);
}

beforeAll(async () => {
  h = await startHarness(NOW);

  const { rows } = await h.owner.query<{ client_id: string; contact_id: string }>(
    'select c.client_id, min(ct.id::text)::uuid as contact_id from consent c ' +
      'join contact ct on ct.client_id = c.client_id ' +
      "where c.purpose = 'participation' and c.status = 'active' " +
      'group by c.client_id order by c.client_id limit 1',
  );
  const found = rows[0];
  if (!found) throw new Error('No seeded client can be sent a report.');
  clientId = found.client_id;
  contactId = found.contact_id;

  const householdUser = '00000000-0000-4000-8000-0000000007e1';
  await h.owner.query(
    'insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, $4)',
    [householdUser, h.data.tenant.id, householdAuthId, 'Household login'],
  );
  await h.owner.query(
    "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'client_contact')",
    [h.data.tenant.id, householdUser],
  );
  await h.owner.query(
    'update contact set user_id = $1, is_legal_guardian = true, can_receive_reports = true, ' +
      'whatsapp_opt_in = true where id = $2',
    [householdUser, contactId],
  );

  const financeUser = '00000000-0000-4000-8000-0000000007e3';
  await h.owner.query(
    'insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, $4)',
    [financeUser, h.data.tenant.id, financeAuthId, 'Books only'],
  );
  await h.owner.query(
    "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'finance')",
    [h.data.tenant.id, financeUser],
  );
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('the row', () => {
  it('admits the kind, filed issued and numbered, with its document and no signer', async () => {
    const bytes = pdf();
    const res = await upload(SEEDED.owner, bytes, { title: '  Brain map,   initial ' });
    expect(res.status).toBe(201);
    const { report } = (await res.json()) as { report: ReportRow };
    expect(report.kind).toBe('external');
    expect(report.status).toBe('issued');
    expect(report.reference).toMatch(/^RPT-\d{6}$/);
    expect(report.issuedOn).toBe('2026-09-01');
    expect(report.title).toBe('Brain map, initial');
    expect(report.signedByName).toBeNull();

    const { rows } = await h.owner.query<{
      content: Record<string, unknown>;
      signed_at: string | null;
      created_by: string;
      recipient_name: string | null;
      practice_legal_name: string | null;
      kind: string;
      mime_type: string;
      is_immutable: boolean;
      sha: string;
      uploaded_by: string;
    }>(
      'select r.content, r.signed_at, r.created_by, r.recipient_name, r.practice_legal_name, ' +
        "d.kind, d.mime_type, d.is_immutable, encode(d.sha256, 'hex') as sha, d.uploaded_by " +
        'from report r join document d on d.id = r.document_id where r.id = $1',
      [report.id],
    );
    const row = rows[0];
    if (!row) throw new Error('The report was not filed with its document.');
    expect(row.content).toEqual({ title: 'Brain map, initial', byteSize: bytes.byteLength });
    expect(row.signed_at).toBeNull();
    const ownerUser = h.data.users[SEEDED.owner]?.id;
    expect(row.created_by).toBe(ownerUser);
    expect(row.uploaded_by).toBe(ownerUser);
    expect(row.recipient_name).toBeTruthy();
    expect(row.practice_legal_name).toBeTruthy();
    expect(row.kind).toBe('report');
    expect(row.mime_type).toBe('application/pdf');
    expect(row.is_immutable).toBe(true);
    expect(row.sha).toBe(digest(bytes));

    // The bytes are in the store, under the key the document names.
    const key = await h.owner.query<{ storage_key: string }>(
      'select storage_key from document where id = $1',
      [report.documentId],
    );
    expect(await h.storage.exists(key.rows[0]?.storage_key ?? '')).toBe(true);
  });

  it('cannot be changed once filed, by anybody', async () => {
    const report = await uploaded();
    await h.owner.query('begin');
    try {
      await h.owner.query(
        "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', 'owner', true)",
        [h.data.tenant.id],
      );
      await rejectsWith(
        h.owner,
        '23001',
        `update report set content = '{"title":"Another title","byteSize":10}'::jsonb where id = $1`,
        [report.id],
      );
      await rejectsWith(
        h.owner,
        '23001',
        "update report set issued_on = '2026-08-01' where id = $1",
        [report.id],
      );
      await rejectsWith(h.owner, '23001', 'delete from report where id = $1', [report.id]);
    } finally {
      await h.owner.query('rollback');
    }
  });

  it('is never a draft, never signed and never the second of anything', async () => {
    await h.owner.query('begin');
    try {
      const base =
        'insert into report (tenant_id, client_id, kind, status, content, number, issued_on, ' +
        'recipient_name, recipient_record_number, practice_legal_name, document_id';
      // A draft of an upload.
      await rejectsWith(
        h.owner,
        '23514',
        "insert into report (tenant_id, client_id, kind, content) values ($1, $2, 'external', " +
          `'{"title":"A draft","byteSize":10}'::jsonb)`,
        [h.data.tenant.id, clientId],
      );
      // A title with nothing in it, and no document.
      await rejectsWith(
        h.owner,
        '23514',
        `${base}) values ($1, $2, 'external', 'issued', '{"title":"","byteSize":10}'::jsonb, ` +
          "999001, current_date, 'Erased client', 'MW-1', 'Practice', null)",
        [h.data.tenant.id, clientId],
      );
      // A signer's name on one.
      await rejectsWith(
        h.owner,
        '23514',
        `${base}, signed_by_name) values ($1, $2, 'external', 'issued', '{}'::jsonb, ` +
          "999002, current_date, 'Erased client', 'MW-1', 'Practice', null, 'Somebody')",
        [h.data.tenant.id, clientId],
      );
    } finally {
      await h.owner.query('rollback');
    }
  });

  it('is never inserted by the API role by hand', async () => {
    await h.owner.query('begin');
    try {
      await asApiRole(h.owner, h.data.tenant.id, async () => {
        await rejectsWith(
          h.owner,
          '42501',
          'insert into report (tenant_id, client_id, kind, status, content) values ' +
            `($1, $2, 'external', 'issued', '{"title":"By hand","byteSize":10}'::jsonb)`,
          [h.data.tenant.id, clientId],
        );
      });
    } finally {
      await h.owner.query('rollback');
    }
  });

  it('refuses a report dated on a day still to come', async () => {
    await h.asPerson(SEEDED.owner, async (db) => {
      await rejectsWith(
        db,
        '23514',
        "select app.file_external_report($1, 'Brain map', '2999-01-01', 10, gen_random_uuid(), " +
          "'k/not-used', decode(repeat('ab', 32), 'hex'), null)",
        [clientId],
      );
    });
  });

  it('is invisible to another practice, and cannot be filed into one', async () => {
    const report = await uploaded();
    const otherTenant = '00000000-0000-4000-8000-0000000007f1';
    await h.owner.query('begin');
    try {
      await h.owner.query("insert into tenant (id, legal_name) values ($1, 'Practice B')", [
        otherTenant,
      ]);
      await asApiRole(h.owner, otherTenant, async () => {
        const seen = await h.owner.query('select id from report where id = $1', [report.id]);
        expect(seen.rowCount).toBe(0);
        const documents = await h.owner.query('select id from document where id = $1', [
          report.documentId,
        ]);
        expect(documents.rowCount).toBe(0);
      });
      await h.owner.query("select set_config('app.actor_id', $1, true)", [
        h.data.users[SEEDED.owner]?.id,
      ]);
      await asApiRole(h.owner, otherTenant, async () => {
        await rejectsWith(
          h.owner,
          'P0002',
          "select app.file_external_report($1, 'Brain map', '2026-09-01', 10, gen_random_uuid(), " +
            "'k/not-used', decode(repeat('cd', 32), 'hex'), null)",
          [clientId],
        );
      });
    } finally {
      await h.owner.query('rollback');
    }
  });
});

describe('the upload door', () => {
  it('refuses a declared type that is not a PDF', async () => {
    const res = await upload(SEEDED.owner, pdf(), { contentType: 'text/html' });
    expect(res.status).toBe(415);
  });

  it('refuses bytes that are not a PDF, whatever they are called', async () => {
    const html = new TextEncoder().encode('<html><body>not a report</body></html>');
    const res = await upload(SEEDED.owner, html);
    expect(res.status).toBe(415);
    expect(((await res.json()) as { code: string }).code).toBe('not_a_pdf');
  });

  it('refuses a file over twenty megabytes before reading it', async () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(pdf());
    const res = await upload(SEEDED.owner, big);
    expect(res.status).toBe(413);
  });

  it('refuses bytes that are not the ones declared', async () => {
    const res = await upload(SEEDED.owner, pdf(), { sha: 'a'.repeat(64) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('digest_mismatch');
  });

  it('refuses a missing title and a date still to come', async () => {
    const untitled = await upload(SEEDED.owner, pdf(), { title: '   ' });
    expect(untitled.status).toBe(400);
    expect(((await untitled.json()) as { code: string }).code).toBe('no_title');
    const tomorrow = await upload(SEEDED.owner, pdf(), { reportDate: '2026-09-07' });
    expect(tomorrow.status).toBe(400);
    expect(((await tomorrow.json()) as { code: string }).code).toBe('date_in_future');
  });

  it('reads a title in Arabic as it was typed', async () => {
    const title = 'تقرير خريطة الدماغ';
    const report = await uploaded(SEEDED.owner, { title });
    expect(report.title).toBe(title);
  });

  it('hands back the report already filed when the same file is sent again', async () => {
    const bytes = pdf();
    const first = await upload(SEEDED.owner, bytes);
    expect(first.status).toBe(201);
    const filed = ((await first.json()) as { report: ReportRow }).report;
    const again = await upload(SEEDED.owner, bytes, { title: 'A second title' });
    expect(again.status).toBe(200);
    const second = ((await again.json()) as { report: ReportRow }).report;
    expect(second.id).toBe(filed.id);
    expect(second.title).toBe(filed.title);
  });

  it('is open to whoever may write a report, and to nobody else', async () => {
    // The admin reads and delivers and never drafts; finance has no business in a report.
    expect((await upload(SEEDED.admin, pdf())).status).toBe(403);
    const query = new URLSearchParams({ clientId, reportDate: '2026-09-01' });
    const bytes = pdf();
    const finance = await h.api.request(`/api/reports/external?${query.toString()}`, {
      method: 'POST',
      headers: {
        authorization: await bearerFor(financeAuthId),
        'content-type': 'application/pdf',
        'x-sha256': digest(bytes),
        'x-report-title': 'Brain%20map',
      },
      body: new Uint8Array(bytes),
    });
    expect(finance.status).toBe(403);

    // A practitioner, for a client on her schedule and not otherwise: off it,
    // the client is simply not there for her.
    const index = h.data.clients.findIndex((c) => c.id === clientId);
    expect((await upload(SEEDED.practitioner, pdf())).status).toBe(404);
    await h.onSchedule(index, SEEDED.practitioner);
    const mine = await upload(SEEDED.practitioner, pdf());
    expect(mine.status).toBe(201);
    expect(await refusalsOnTrail(h.owner, 'report.upload_refused', { clientId })).toContain(
      'not_permitted',
    );
  });
});

describe('opening, sending and the household', () => {
  it('is listed for the practice as an uploaded report, and opens through a link', async () => {
    const report = await uploaded(SEEDED.owner, { title: 'Follow-up brain map' });
    const list = await h.call('GET', `/api/reports?clientId=${clientId}`, SEEDED.owner);
    const rows = ((await list.json()) as ReportListResponse).reports;
    const row = rows.find((r) => r.id === report.id);
    expect(row?.kind).toBe('external');
    expect(row?.title).toBe('Follow-up brain map');

    const one = await h.call('GET', `/api/reports/${report.id}`, SEEDED.owner);
    expect(one.status).toBe(200);
    const body = (await one.json()) as ReportResponse;
    expect(body.url).toBeTruthy();
    expect(body.report.title).toBe('Follow-up brain map');
  });

  it('says, by name, that a missing upload cannot be made again', async () => {
    const report = await uploaded();
    const key = await h.owner.query<{ storage_key: string }>(
      'select storage_key from document where id = $1',
      [report.documentId],
    );
    await h.storage.delete(key.rows[0]?.storage_key ?? '');
    const res = await h.call('GET', `/api/reports/${report.id}`, SEEDED.owner);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('upload_missing');
  });

  it('is sent to the household as any signed report is', async () => {
    const report = await uploaded();
    const res = await h.call('POST', `/api/reports/${report.id}/deliver`, SEEDED.owner, {
      contactId,
      channel: 'whatsapp',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as DeliverResponse;
    expect(body.message).toContain(report.reference ?? 'no reference');
    expect(body.handoffUrl).toMatch(/^https:\/\/wa\.me\//);
  });

  it('is never corrected through the signed reports’ door', async () => {
    const report = await uploaded();
    const res = await h.call('POST', `/api/reports/${report.id}/supersede`, SEEDED.owner, {
      reason: 'The wrong file was uploaded.',
      content: {},
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('external_report');
  });

  it('is listed for its own household, with its title, and opens there', async () => {
    const report = await uploaded(SEEDED.owner, { title: 'Brain map for the family' });
    const res = await callWithToken('GET', '/api/portal/reports', householdAuthId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PortalReportsResponse;
    const row = body.reports.find((r) => r.id === report.id);
    expect(row?.kind).toBe('external');
    expect(row?.title).toBe('Brain map for the family');

    const link = await callWithToken(
      'GET',
      `/api/portal/reports/${report.documentId}/link`,
      householdAuthId,
    );
    expect(link.status).toBe(200);
    expect(((await link.json()) as DocumentLinkResponse).url).toBeTruthy();
  });

  it('is never shown to another household', async () => {
    const other = h.data.clients.find((c) => c.id !== clientId);
    if (!other) throw new Error('The seed has one client.');
    const theirs = await uploaded(SEEDED.owner, { client: other.id });
    const res = await callWithToken('GET', '/api/portal/reports', householdAuthId);
    const body = (await res.json()) as PortalReportsResponse;
    expect(body.reports.map((r) => r.id)).not.toContain(theirs.id);
    const link = await callWithToken(
      'GET',
      `/api/portal/reports/${theirs.documentId}/link`,
      householdAuthId,
    );
    expect(link.status).toBe(404);
  });
});

describe('erasure', () => {
  it('takes the title and the file, and keeps the row saying a report existed', async () => {
    const other = h.data.clients.find((c) => c.id !== clientId);
    if (!other) throw new Error('The seed has too few clients.');
    const report = await uploaded(SEEDED.owner, { client: other.id, title: 'To be erased' });
    const key = await h.owner.query<{ storage_key: string }>(
      'select storage_key from document where id = $1',
      [report.documentId],
    );
    const storageKey = key.rows[0]?.storage_key ?? '';

    const request = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason) ' +
        "values ($1, $2, 'The household asked.') returning id",
      [h.data.tenant.id, other.id],
    );
    await h.owner.query(
      "select set_config('app.tenant_id', $1, false), set_config('app.actor_roles', 'owner', false)",
      [h.data.tenant.id],
    );
    await h.owner.query('select app.erase_client($1, $2)', [other.id, request.rows[0]?.id]);
    await h.owner.query(
      "select set_config('app.tenant_id', '', false), set_config('app.actor_roles', '', false)",
    );

    const after = await h.owner.query<{
      content: Record<string, unknown>;
      document_id: string | null;
      reference: string;
      status: string;
      recipient_name: string;
    }>('select content, document_id, reference, status, recipient_name from report where id = $1', [
      report.id,
    ]);
    const row = after.rows[0];
    expect(row?.content).toEqual({});
    expect(row?.document_id).toBeNull();
    expect(row?.reference).toMatch(/^RPT-/);
    expect(row?.status).toBe('issued');
    expect(row?.recipient_name).toBe('Erased client');

    const document_ = await h.owner.query('select id from document where id = $1', [
      report.documentId,
    ]);
    expect(document_.rowCount).toBe(0);
    const pending = await h.owner.query<{ keys: { storageKey: string }[] }>(
      'select storage_keys_pending as keys from erasure_request where id = $1',
      [request.rows[0]?.id],
    );
    expect(pending.rows[0]?.keys.map((entry) => entry.storageKey)).toContain(storageKey);
  });
});
