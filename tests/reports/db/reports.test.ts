import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractAll } from '../../../domain/shared/document';
import { renderReport } from '../../../domain/reports/document';
import { documentFonts } from '../../../app/api/billing/fonts';
import { documentFrom, readReport } from '../../../app/api/reports/source';
import type {
  DeliverResponse,
  DraftResponse,
  GatherResponse,
  IssueResponse,
  ReportListResponse,
  ReportResponse,
  SupersedeResponse,
  VisitsResponse,
} from '../../../app/api/reports/schema';
import { progressBody, sessionBody, SEEDED, startHarness, type Harness } from './support';

/**
 * Drafting a report, signing it, rendering it and filing it — through the API
 * the server actually builds, against the real local document store.
 *
 * The proof that matters most here is the byte-identical re-render: a report's
 * stored `content`, plus the snapshots on its own row, produce exactly the
 * bytes that were filed. That is what makes the snapshot rule of section 3
 * true rather than intended.
 */

const NOW = () => new Date('2026-09-06T08:00:00.000Z');

let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
}, 120_000);

afterAll(async () => {
  await h.close();
});

/** A saved progress draft for a client, as the owner. */
async function draftFor(clientIndex: number, over: Record<string, unknown> = {}): Promise<string> {
  const res = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
    clientId: h.clientId(clientIndex),
    kind: 'progress',
    locale: 'en',
    coverageFrom: '2026-06-01',
    coverageTo: '2026-09-01',
    content: progressBody(),
    ...over,
  });
  if (res.status !== 201) throw new Error(`Draft was refused: ${res.status}`);
  const body = (await res.json()) as DraftResponse;
  return body.report.id;
}

/** The same, signed by the founder, who is the practice's only signer. */
async function issued(clientIndex: number): Promise<string> {
  const id = await draftFor(clientIndex);
  const res = await h.call('POST', `/api/reports/${id}/issue`, SEEDED.owner, {});
  if (res.status !== 201) throw new Error(`Issue was refused: ${res.status} ${await res.text()}`);
  return id;
}

describe('drafting', () => {
  it('creates a draft with no reference, no signature and no document', async () => {
    const id = await draftFor(0);
    const { rows } = await h.owner.query<{
      status: string;
      reference: string | null;
      signed_at: Date | null;
      document_id: string | null;
    }>('select status, reference, signed_at, document_id from report where id = $1', [id]);
    expect(rows[0]).toMatchObject({
      status: 'draft',
      reference: null,
      signed_at: null,
      document_id: null,
    });
  });

  it('gathers the figures from the record and ignores the ones a caller sent', async () => {
    // A figure a practitioner could retype is a figure that can disagree with
    // the record (section 4.2).
    const res = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      clientId: h.clientId(1),
      kind: 'progress',
      coverageFrom: '2026-06-01',
      coverageTo: '2026-09-01',
      content: progressBody({ sessionsDelivered: 99, sessionsEntitled: 99 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as DraftResponse;
    const content = body.content as { sessionsDelivered: number; sessionsEntitled: number };
    expect(content.sessionsDelivered).toBe(0);
    expect(content.sessionsEntitled).toBe(0);
  });

  it('keeps what the practitioner wrote', async () => {
    const res = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      clientId: h.clientId(2),
      kind: 'progress',
      coverageFrom: '2026-06-01',
      coverageTo: '2026-09-01',
      content: progressBody({ summary: 'Settling faster.', suggestion: 'Three more.' }),
    });
    const body = (await res.json()) as DraftResponse;
    const content = body.content as { summary: string; suggestion: string };
    expect(content.summary).toBe('Settling faster.');
    expect(content.suggestion).toBe('Three more.');
  });

  it('refuses a body the shape does not accept, and names the field', async () => {
    // Rule 2 (section 8), reaching a person as a field name rather than as
    // "invalid". A coverage that ends before it begins is the one thing a
    // caller can still put into a progress body: everything else in it is
    // gathered from the record and never trusted from the request.
    const res = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      clientId: h.clientId(0),
      kind: 'progress',
      coverageFrom: '2026-09-01',
      coverageTo: '2026-06-01',
      content: progressBody(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { field: string }).toMatchObject({ field: 'coverageTo' });
  });

  it('writes a read for the client before answering with the record', async () => {
    // The route answers a household's goals in their own words and every
    // completed visit's figures. docs/SPEC/audit.md section 5 asks for a read
    // row whenever that leaves, whether or not anything changed.
    const before = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' " +
        "and entity_type = 'client' and entity_id = $1",
      [h.clientId(1)],
    );
    const res = await h.call(
      'GET',
      `/api/reports/gather?clientId=${h.clientId(1)}&from=2026-06-01&to=2026-09-01`,
      SEEDED.owner,
    );
    expect(res.status).toBe(200);
    const after = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' " +
        "and entity_type = 'client' and entity_id = $1",
      [h.clientId(1)],
    );
    expect(Number(after.rows[0]?.n ?? 0)).toBe(Number(before.rows[0]?.n ?? 0) + 1);
  });

  it('reads the brain maps where the table is there, and says nothing about a household never measured', async () => {
    // The assessment stream merged beside this one, so its table is on this
    // database and the guarded read takes the present path (section 6 still
    // declares no foreign key: another database may carry neither range).
    // Client 0 has never been measured, so there is nothing to compare and the
    // report says nothing rather than putting a heading over a hole.
    const res = await h.call(
      'GET',
      `/api/reports/gather?clientId=${h.clientId(0)}&from=2026-06-01&to=2026-09-01`,
      SEEDED.owner,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as GatherResponse;
    expect(body.brainMapsRead).toBe(true);
    expect((body.content as { comparison: unknown }).comparison).toBeNull();
  });

  it('compares the two brain maps a household actually has, in the words the comparison screen uses', async () => {
    // Client 5 carries two brain maps of one instrument and one questionnaire
    // between them. It read "fewer than two brain maps" for both reasons at
    // once (docs/CHANGE-REQUESTS/qa-01.md item 3): every figure was skipped,
    // because they were looked for under a `label` nothing writes rather than
    // under the site and band a brain map declares; and the questionnaire
    // could stand at either end of the pair and make it a comparison across
    // two instruments, which is refused.
    //
    // `docs/SPEC/reports-v1.md` section 5 is what settles which figures may be
    // printed: the progress report carries "the same figures ... the
    // comparison view shows". The sentence about electrode sites in the same
    // section is about the *protocol's* — the practice's own way of training,
    // which is its intellectual property — and not about a measurement the
    // household paid to have taken.
    const res = await h.call(
      'GET',
      `/api/reports/gather?clientId=${h.clientId(5)}&from=2026-01-01&to=2026-09-01`,
      SEEDED.owner,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as GatherResponse;
    expect(body.brainMapsRead).toBe(true);
    const comparison = (
      body.content as {
        comparison: {
          instrument: string;
          earlierOn: string;
          laterOn: string;
          lines: { label: string; unit: string; earlier: number; later: number }[];
        } | null;
      }
    ).comparison;
    expect(comparison).not.toBeNull();
    expect(comparison?.instrument).toBe('qeeg');
    // The earliest and the latest brain map, and never the questionnaire that
    // sits between them.
    expect(comparison?.earlierOn).toBe('2026-03-06');
    expect(comparison?.laterOn).toBe('2026-06-04');
    // Five sites by five bands, each named as the Compare screen names it.
    expect(comparison?.lines.length).toBe(25);
    const first = comparison?.lines[0];
    expect(first?.label).toBe('Fz Delta');
    expect(first?.unit).toBe('µV²');
    expect(typeof first?.earlier).toBe('number');
    expect(typeof first?.later).toBe('number');
  });

  it('carries that comparison into a saved draft, which is what the practitioner reads', async () => {
    const res = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      clientId: h.clientId(5),
      kind: 'progress',
      locale: 'en',
      coverageFrom: '2026-01-01',
      coverageTo: '2026-09-01',
      content: progressBody(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as DraftResponse;
    const content = body.content as { comparison: { lines: { label: string }[] } | null };
    expect(content.comparison).not.toBeNull();
    expect(content.comparison?.lines.length).toBe(25);
  });
});

describe('the session report', () => {
  it('lists the completed visits a report may be written about', async () => {
    const visit = await h.completedVisit(4);
    const res = await h.call('GET', `/api/reports/visits?clientId=${h.clientId(4)}`, SEEDED.owner);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VisitsResponse;
    expect(body.visits.map((row) => row.id)).toContain(visit);
    expect(body.visits[0]?.serviceName).toBeTruthy();
    expect(body.visits[0]?.practitionerName).toBeTruthy();
  });

  it('gathers one visit’s own figures, and never a protocol', async () => {
    const visit = await h.completedVisit(4);
    const res = await h.call(
      'GET',
      `/api/reports/gather-session?clientId=${h.clientId(4)}&sessionId=${visit}&locale=en`,
      SEEDED.owner,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as GatherResponse;
    const content = body.content as {
      sessionId: string;
      ratings: { before: number | null; after: number | null }[];
      observationChips: string[];
      tolerance: number | null;
    };
    expect(content.sessionId).toBe(visit);
    expect(content.ratings[0]).toMatchObject({ before: 4, after: 7 });
    expect(content.observationChips).toEqual(['Nothing to note']);
    expect(content.tolerance).toBe(9);
    // Nothing about the training's own settings travels: there is no field to
    // put one in, and the raw telemetry is not read at all.
    expect(JSON.stringify(content)).not.toContain('threshold');
    expect(JSON.stringify(content)).not.toContain('Cz');
  });

  it('drafts, signs and files one, and the page carries the visit', async () => {
    const visit = await h.completedVisit(4);
    const drafted = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      clientId: h.clientId(4),
      kind: 'session',
      locale: 'en',
      sessionId: visit,
      content: { note: 'A steady visit.', beforeNextVisit: 'Keep to the same bedtime.' },
    });
    expect(drafted.status).toBe(201);
    const draft = (await drafted.json()) as DraftResponse;
    const body = draft.content as { sessionId: string; note: string; serviceName: string };
    expect(body.sessionId).toBe(visit);
    expect(body.note).toBe('A steady visit.');
    expect(body.serviceName).toBeTruthy();

    const issued = await h.call('POST', `/api/reports/${draft.report.id}/issue`, SEEDED.owner, {});
    expect(issued.status).toBe(201);
    const answer = (await issued.json()) as IssueResponse;
    expect(answer.report.kind).toBe('session');
    expect(answer.report.reference).toMatch(/^RPT-\d{6}$/);
    expect(answer.report.documentId).toBeTruthy();
  });

  it('refuses a session draft that names no visit, and one that names another client’s', async () => {
    const none = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      clientId: h.clientId(4),
      kind: 'session',
      content: { note: '', beforeNextVisit: '' },
    });
    expect(none.status).toBe(400);
    expect((await none.json()) as { code: string }).toMatchObject({ code: 'visit_required' });

    const elsewhere = await h.completedVisit(2);
    const wrong = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      clientId: h.clientId(4),
      kind: 'session',
      sessionId: elsewhere,
      content: { note: '', beforeNextVisit: '' },
    });
    expect(wrong.status).toBe(404);
    expect((await wrong.json()) as { code: string }).toMatchObject({ code: 'no_such_visit' });
  });

  it('ignores the figures a caller sends and takes the visit’s own', async () => {
    const visit = await h.completedVisit(4);
    const res = await h.call('POST', '/api/reports/draft', SEEDED.owner, {
      clientId: h.clientId(4),
      kind: 'session',
      sessionId: visit,
      content: sessionBody({
        note: 'Mine.',
        practitionerName: 'Somebody Else',
        durationMinutes: 600,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as DraftResponse;
    const content = body.content as { practitionerName: string; durationMinutes: number };
    expect(content.practitionerName).not.toBe('Somebody Else');
    expect(content.durationMinutes).toBe(50);
  });
});

describe('issuing', () => {
  it('allocates a reference, snapshots the signer and the practice, and files a PDF', async () => {
    const id = await draftFor(3);
    const res = await h.call('POST', `/api/reports/${id}/issue`, SEEDED.owner, {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as IssueResponse;
    expect(body.report.reference).toMatch(/^RPT-\d{6}$/);
    expect(body.report.status).toBe('issued');
    expect(body.report.signedByName).toBeTruthy();

    const { rows } = await h.owner.query<{
      signed_by_certification: string;
      signed_by_certifying_body: string;
      signed_by_certificate_number: string;
      practice_legal_name: string;
      practice_licence_number: string;
      document_id: string;
    }>(
      'select signed_by_certification, signed_by_certifying_body, signed_by_certificate_number, ' +
        'practice_legal_name, practice_licence_number, document_id from report where id = $1',
      [id],
    );
    const row = rows[0];
    if (!row) throw new Error('The report was not written.');
    // A progress report names no service, so any valid signing credential
    // will do; the function takes the most durable one, which for the founder
    // is the certificate with no end date (migration 600).
    const held = await h.owner.query<{ n: string }>(
      'select count(*)::text as n from credential where certification = $1 ' +
        'and practitioner_id = $2 and can_sign_report',
      [row.signed_by_certification, h.practitionerIdOf(SEEDED.owner)],
    );
    expect(Number(held.rows[0]?.n ?? 0)).toBe(1);
    expect(row.signed_by_certifying_body).toBeTruthy();
    expect(row.signed_by_certificate_number).toBeTruthy();
    expect(row.practice_legal_name).toBeTruthy();
    expect(row.document_id).toBeTruthy();

    const document_ = await h.owner.query<{
      kind: string;
      mime_type: string;
      is_immutable: boolean;
      storage_key: string;
      sha256: Buffer;
      retention_until: Date | null;
      client_id: string;
    }>(
      'select kind, mime_type, is_immutable, storage_key, sha256, retention_until, client_id ' +
        'from document where id = $1',
      [row.document_id],
    );
    const filed = document_.rows[0];
    if (!filed) throw new Error('No document row was written.');
    expect(filed.kind).toBe('report');
    expect(filed.mime_type).toBe('application/pdf');
    expect(filed.is_immutable).toBe(true);
    expect(filed.client_id).toBe(h.clientId(3));
    expect(filed.retention_until?.getUTCFullYear()).toBe(2031);
    // A key made of ids alone: no name, no record number (docs/SEAMS.md).
    expect(filed.storage_key).toBe(
      `tenant/${h.data.tenant.id}/client/${h.clientId(3)}/${row.document_id}`,
    );

    // The bytes are there by the time the caller was told the report exists.
    expect(await h.storage.exists(filed.storage_key)).toBe(true);
    const stored = await h.storage.read?.(filed.storage_key);
    if (!stored) throw new Error('The store holds nothing at that key.');
    expect(createHash('sha256').update(stored).digest('hex')).toBe(filed.sha256.toString('hex'));
    expect(stored.subarray(0, 8).toString('latin1')).toBe('%PDF-1.7');
  });

  it('renders what the report says, with both standing sentences and the draft line', async () => {
    const id = await issued(4);
    const { rows } = await h.owner.query<{ storage_key: string }>(
      'select d.storage_key from report r join document d on d.id = r.document_id where r.id = $1',
      [id],
    );
    const stored = await h.storage.read?.(rows[0]?.storage_key ?? '');
    if (!stored) throw new Error('The store holds nothing at that key.');
    const text = extractAll(stored);
    expect(text).toContain('Progress report');
    expect(text).toContain('McWellness is a wellness provider, not a medical clinic');
    expect(text).toContain('It is not a diagnosis.');
    expect(text).toContain("Draft wording, in use until the practice's lawyer approves");
    expect(text).toContain('It is not a tax number.');
    // Decision 4: no tax number on a report, in either direction.
    expect(text).not.toContain('TRN');
  });

  it('re-renders byte-identically from the stored content and snapshots', async () => {
    // The proof that the snapshot rule actually holds (section 11).
    const id = await issued(5);
    const { rows } = await h.owner.query<{ storage_key: string; sha256: Buffer }>(
      'select d.storage_key, d.sha256 from report r join document d on d.id = r.document_id ' +
        'where r.id = $1',
      [id],
    );
    const filed = rows[0];
    if (!filed) throw new Error('The report was not filed.');
    const stored = await h.storage.read?.(filed.storage_key);
    if (!stored) throw new Error('The store holds nothing at that key.');

    // Read the row back exactly as the repair path does, and render it again —
    // **from the row alone**, with no join to `client` and nothing read live.
    // The owner connection carries no tenant stamp of its own, and every query
    // in `source.ts` is written against `app.current_tenant_id()`, so it is set
    // here — which is also the point: the read is the practice's, scoped.
    await h.owner.query("select set_config('app.tenant_id', $1, false)", [h.data.tenant.id]);
    const record = await readReport(h.owner, id);
    if (!record) throw new Error('The report is not readable.');
    const document_ = documentFrom(record);
    if (!document_) throw new Error('The row does not render.');
    const again = renderReport(document_, documentFonts());

    expect(createHash('sha256').update(again).digest('hex')).toBe(filed.sha256.toString('hex'));
    expect(Buffer.from(again).equals(stored)).toBe(true);
  });

  it('re-renders the same bytes after the client’s name is corrected', async () => {
    // The recipient block is a snapshot, so a household correcting the
    // spelling of a child's name does not change the document they were sent.
    // Read live, this was the test that failed: the repair path refused the
    // report for ever afterwards, because bytes rendered from this year's name
    // can never match the ones that were filed.
    const id = await issued(19);
    const { rows } = await h.owner.query<{
      sha256: Buffer;
      client_id: string;
      recipient_name: string;
    }>(
      'select d.sha256, r.client_id, r.recipient_name from report r ' +
        'join document d on d.id = r.document_id where r.id = $1',
      [id],
    );
    const filed = rows[0];
    if (!filed) throw new Error('The report was not filed.');

    // A different given name from the one on the snapshot, whichever that is.
    // Both are on the fixed fictional list (db/seed/names.ts).
    const corrected = filed.recipient_name.startsWith('Willow') ? 'Juniper' : 'Willow';
    await h.owner.query('update client set given_name = $2 where id = $1', [
      filed.client_id,
      corrected,
    ]);

    await h.owner.query("select set_config('app.tenant_id', $1, false)", [h.data.tenant.id]);
    const record = await readReport(h.owner, id);
    const document_ = record ? documentFrom(record) : null;
    if (!document_) throw new Error('The row does not render.');
    expect(document_.recipient.name).toBe(filed.recipient_name);
    expect(document_.recipient.name).not.toContain(corrected);

    const again = renderReport(document_, documentFonts());
    expect(createHash('sha256').update(again).digest('hex')).toBe(filed.sha256.toString('hex'));
  });

  it('refuses a second issue of the same report', async () => {
    const id = await issued(6);
    const res = await h.call('POST', `/api/reports/${id}/issue`, SEEDED.owner, {});
    expect(res.status).toBe(422);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'already_issued' });
  });

  it('refuses a practitioner signing their own draft without the capability', async () => {
    // The deny case section 11 actually names, met the way the practice meets
    // it: the person signing is the person calling, and their own certificate
    // does not carry the right.
    await h.onSchedule(7, SEEDED.practitioner);
    const id = await draftFor(7);
    const res = await h.call('POST', `/api/reports/${id}/issue`, SEEDED.practitioner, {});
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: 'credential_cannot_sign',
    });
  });

  it('refuses a caller who names a practitioner who is not them', async () => {
    // The route names nobody, so this is asked of the door itself: even the
    // owner, calling app.issue_report directly, cannot put the practitioner's
    // name on a report (section 10, decision 3). Without this the trail would
    // name the actor and the document would name somebody else.
    const id = await draftFor(16);
    await expect(
      h.asPerson(SEEDED.owner, (db) =>
        db.query('select id from app.issue_report($1::uuid, $2::uuid, $3::date)', [
          id,
          h.practitionerIdOf(SEEDED.practitioner),
          '2026-09-06',
        ]),
      ),
    ).rejects.toThrow(/signed by the person issuing it/);

    const { rows } = await h.owner.query<{ status: string }>(
      'select status from report where id = $1',
      [id],
    );
    expect(rows[0]?.status).toBe('draft');
  });

  it('refuses a credential that lapsed the day before signing, and says so', async () => {
    // The founder's own certificate, ended yesterday. The route reads it fresh
    // at the moment of signing, so this is the credential that decides.
    const practitionerId = h.practitionerIdOf(SEEDED.owner);
    await h.owner.query(
      "update credential set valid_to = '2026-09-05' where practitioner_id = $1 and can_sign_report",
      [practitionerId],
    );
    const id = await draftFor(8);
    const res = await h.call('POST', `/api/reports/${id}/issue`, SEEDED.owner, {});
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'credential_lapsed' });

    // The refusal is on the trail, before the answer (section 8).
    const trail = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'report.issue_refused'",
    );
    expect(Number(trail.rows[0]?.n ?? 0)).toBeGreaterThan(0);

    await h.owner.query(
      "update credential set valid_to = '2029-01-14' where practitioner_id = $1 and can_sign_report " +
        "and service_type_id = (select id from service_type where code = 'nf-session')",
      [practitionerId],
    );
    await h.owner.query(
      'update credential set valid_to = null where practitioner_id = $1 and can_sign_report ' +
        "and service_type_id = (select id from service_type where code = 'brain-map')",
      [practitionerId],
    );
  });

  it('rolls the whole issue back when the row it just wrote will not render', async () => {
    // The number is allocated and the signature written inside
    // app.issue_report. If the render then fails, a *returned* 422 would
    // commit that — the transaction rolls back on a raise or a 5xx and on
    // nothing else — leaving a numbered, signed report with no document,
    // which nothing could ever file afterwards: a second issue is refused as
    // already signed, and the repair path has no bytes to compare.
    //
    // The failure is forced the only way it can happen: a stored body the
    // shape no longer recognises. A draft may be updated, so this is written
    // straight to the row.
    const id = await draftFor(17);
    await h.owner.query(
      'update report set content = \'{"kind":"progress"}\'::jsonb where id = $1',
      [id],
    );

    const res = await h.call('POST', `/api/reports/${id}/issue`, SEEDED.owner, {});
    expect(res.status).toBe(500);

    const { rows } = await h.owner.query<{
      status: string;
      number: number | null;
      reference: string | null;
      signed_at: Date | null;
      document_id: string | null;
    }>('select status, number, reference, signed_at, document_id from report where id = $1', [id]);
    expect(rows[0]).toMatchObject({
      status: 'draft',
      number: null,
      reference: null,
      signed_at: null,
      document_id: null,
    });
  });

  it('refuses an id that is not a uuid with a 400, on every route that takes one', async () => {
    // Unvalidated, the path reached a uuid column and Postgres raised, which
    // the error handler answered as a 500 — on a path a stranger can call.
    for (const path of ['/api/reports/nonsense', '/api/reports/nonsense/preview']) {
      const res = await h.call('GET', path, SEEDED.owner);
      expect(res.status, path).toBe(400);
    }
    for (const path of ['issue', 'supersede', 'deliver']) {
      const res = await h.call('POST', `/api/reports/nonsense/${path}`, SEEDED.owner, {});
      expect(res.status, path).toBe(400);
    }
  });
});

describe('reading one', () => {
  it('hands back a short-lived signed link and records the read before signing it', async () => {
    const id = await issued(9);
    const before = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_type = 'document'",
    );
    const res = await h.call('GET', `/api/reports/${id}`, SEEDED.owner);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportResponse;
    expect(body.url).toBeTruthy();
    expect(body.expiresInSeconds).toBe(300);
    const after = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_type = 'document'",
    );
    expect(Number(after.rows[0]?.n)).toBeGreaterThan(Number(before.rows[0]?.n));
  });

  it('repairs bytes the store never received, from the row alone', async () => {
    const id = await issued(10);
    const { rows } = await h.owner.query<{ storage_key: string }>(
      'select d.storage_key from report r join document d on d.id = r.document_id where r.id = $1',
      [id],
    );
    const key = rows[0]?.storage_key ?? '';
    await h.storage.delete(key);
    expect(await h.storage.exists(key)).toBe(false);

    const res = await h.call('GET', `/api/reports/${id}`, SEEDED.owner);
    expect(res.status).toBe(200);
    expect(await h.storage.exists(key)).toBe(true);
  });

  it('refuses to repair with bytes that differ from what was filed', async () => {
    // Writing bytes that are not the filed ones under the filed key would
    // replace a household's document with a different one, so the repair path
    // compares the fingerprint first and refuses when it does not match.
    //
    // Forced by moving the fingerprint rather than by renaming the client: now
    // that the recipient block is a snapshot, nothing outside the report's own
    // row can change what it renders to — which is the point of the fix, and
    // means this refusal can only be provoked at the document row itself.
    const id = await issued(11);
    const { rows } = await h.owner.query<{ storage_key: string; document_id: string }>(
      'select d.storage_key, d.id as document_id from report r ' +
        'join document d on d.id = r.document_id where r.id = $1',
      [id],
    );
    const key = rows[0]?.storage_key ?? '';
    await h.storage.delete(key);
    await h.owner.query(
      "update document set sha256 = decode(repeat('ab', 32), 'hex') where id = $1",
      [rows[0]?.document_id],
    );

    const res = await h.call('GET', `/api/reports/${id}`, SEEDED.owner);
    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: 'document_bytes_differ',
    });
    expect(await h.storage.exists(key)).toBe(false);
  });
});

describe('superseding', () => {
  it('writes a new draft, marks the standing version superseded and keeps both', async () => {
    const first = await issued(12);
    const res = await h.call('POST', `/api/reports/${first}/supersede`, SEEDED.owner, {
      reason: 'The coverage ended a week later than it says.',
      content: progressBody({ summary: 'Corrected.' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as SupersedeResponse;
    expect(body.report.version).toBe(2);
    expect(body.report.status).toBe('draft');
    expect(body.report.supersedesId).toBe(first);
    expect(body.report.amendmentReason).toContain('a week later');

    const { rows } = await h.owner.query<{ status: string }>(
      'select status from report where id = $1',
      [first],
    );
    expect(rows[0]?.status).toBe('superseded');
  });

  it('refuses a practitioner, who may draft one and may not replace one', async () => {
    // Section 7.1 gives superseding to the owner and the lead practitioner
    // alone. This practitioner is on the client's schedule, so drafting is
    // open to them and nothing about visibility is in the way — the refusal is
    // the act's own.
    await h.onSchedule(18, SEEDED.practitioner);
    const first = await issued(18);
    const res = await h.call('POST', `/api/reports/${first}/supersede`, SEEDED.practitioner, {
      reason: 'A correction this person may not make.',
      content: progressBody(),
    });
    expect(res.status).toBe(403);

    const { rows } = await h.owner.query<{ status: string }>(
      'select status from report where id = $1',
      [first],
    );
    expect(rows[0]?.status).toBe('issued');

    // Written before the answer, as every refusal is (section 8).
    const trail = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'report.supersede_refused' " +
        'and entity_id = $1',
      [first],
    );
    expect(Number(trail.rows[0]?.n ?? 0)).toBe(1);
  });

  it('refuses a supersede with no reason, and one of an already superseded version', async () => {
    const first = await issued(13);
    const none = await h.call('POST', `/api/reports/${first}/supersede`, SEEDED.owner, {
      reason: '   ',
      content: progressBody(),
    });
    expect(none.status).toBe(422);
    expect((await none.json()) as { code: string }).toMatchObject({ code: 'no_reason' });

    await h.call('POST', `/api/reports/${first}/supersede`, SEEDED.owner, {
      reason: 'The first correction.',
      content: progressBody(),
    });
    const again = await h.call('POST', `/api/reports/${first}/supersede`, SEEDED.owner, {
      reason: 'A second correction of the same version.',
      content: progressBody(),
    });
    expect(again.status).toBe(422);
    expect((await again.json()) as { code: string }).toMatchObject({ code: 'already_superseded' });
  });

  it('refuses a supersede of a draft: a draft is edited, not superseded', async () => {
    const id = await draftFor(14);
    const res = await h.call('POST', `/api/reports/${id}/supersede`, SEEDED.owner, {
      reason: 'Correcting a draft, which is not a thing.',
      content: progressBody(),
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'not_issued' });
  });

  it('follows a chain three versions deep, and only the head may be superseded', async () => {
    const first = await issued(15);
    const second = (
      (await (
        await h.call('POST', `/api/reports/${first}/supersede`, SEEDED.owner, {
          reason: 'The first correction.',
          content: progressBody(),
        })
      ).json()) as SupersedeResponse
    ).report.id;
    await h.call('POST', `/api/reports/${second}/issue`, SEEDED.owner, {});
    const third = (
      (await (
        await h.call('POST', `/api/reports/${second}/supersede`, SEEDED.owner, {
          reason: 'The second correction.',
          content: progressBody(),
        })
      ).json()) as SupersedeResponse
    ).report.id;
    await h.call('POST', `/api/reports/${third}/issue`, SEEDED.owner, {});

    const { rows } = await h.owner.query<{ id: string; version: number; status: string }>(
      'select id, version, status from report where client_id = $1 order by version',
      [h.clientId(15)],
    );
    expect(rows.map((row) => [row.version, row.status])).toEqual([
      [1, 'superseded'],
      [2, 'superseded'],
      [3, 'issued'],
    ]);
    // Each version has one reference of its own, and they are all different.
    const references = await h.owner.query<{ reference: string }>(
      'select reference from report where client_id = $1',
      [h.clientId(15)],
    );
    expect(new Set(references.rows.map((row) => row.reference)).size).toBe(3);
  });
});

describe('listing', () => {
  it('answers a client’s reports, newest first, and records a list on the trail', async () => {
    const res = await h.call('GET', `/api/reports?clientId=${h.clientId(15)}`, SEEDED.owner);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportListResponse;
    expect(body.reports.length).toBe(3);
    const trail = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'list' and entity_type = 'report'",
    );
    expect(Number(trail.rows[0]?.n ?? 0)).toBeGreaterThan(0);
  });

  it('refuses a client id that is not a client id', async () => {
    const res = await h.call('GET', '/api/reports?clientId=nonsense', SEEDED.owner);
    expect(res.status).toBe(400);
  });
});

describe('delivering', () => {
  async function contactOf(clientIndex: number): Promise<string> {
    const { rows } = await h.owner.query<{ id: string }>(
      'select id from contact where client_id = $1 order by id limit 1',
      [h.clientId(clientIndex)],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('That client has no contact.');
    return id;
  }

  it('hands off through WhatsApp, writes a delivery and records the contact and channel', async () => {
    const id = await issued(16);
    const contactId = await contactOf(16);
    await h.owner.query(
      'update contact set can_receive_reports = true, whatsapp_opt_in = true where id = $1',
      [contactId],
    );

    const res = await h.call('POST', `/api/reports/${id}/deliver`, SEEDED.owner, {
      contactId,
      channel: 'whatsapp',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as DeliverResponse;
    expect(body.delivered).toBe(false);
    expect(body.handoffUrl).toMatch(/^https:\/\/wa\.me\//);
    // The message names the document and never what the visit was about.
    expect(body.message).toContain('progress report');
    expect(body.message).toContain('RPT-');

    const delivery = await h.owner.query<{ contact_id: string; channel: string }>(
      'select contact_id, channel from report_delivery where report_id = $1',
      [id],
    );
    expect(delivery.rows[0]?.contact_id).toBe(contactId);
    expect(delivery.rows[0]?.channel).toBe('whatsapp');

    // The trail carries the contact's id and the channel, and no telephone number.
    const trail = await h.owner.query<{ new_values: Record<string, string> }>(
      "select new_values from audit_log where action = 'send' and entity_type = 'report' " +
        'and entity_id = $1',
      [id],
    );
    const details = trail.rows[0]?.new_values;
    expect(details?.contactId).toBe(contactId);
    expect(details?.channel).toBe('whatsapp');
    expect(JSON.stringify(details)).not.toMatch(/\+?971/);
  });

  it('refuses WhatsApp without the opt-in', async () => {
    const id = await issued(17);
    const contactId = await contactOf(17);
    await h.owner.query(
      'update contact set can_receive_reports = true, whatsapp_opt_in = false where id = $1',
      [contactId],
    );
    const res = await h.call('POST', `/api/reports/${id}/deliver`, SEEDED.owner, {
      contactId,
      channel: 'whatsapp',
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'no_whatsapp_opt_in' });
  });

  it('refuses a contact whose record says they do not receive reports', async () => {
    const id = await issued(18);
    const contactId = await contactOf(18);
    await h.owner.query('update contact set can_receive_reports = false where id = $1', [
      contactId,
    ]);
    const res = await h.call('POST', `/api/reports/${id}/deliver`, SEEDED.owner, {
      contactId,
      channel: 'email',
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: 'contact_may_not_receive',
    });
  });

  it('refuses to send without a live participation consent', async () => {
    const id = await issued(19);
    const contactId = await contactOf(19);
    await h.owner.query('update contact set can_receive_reports = true where id = $1', [contactId]);
    await h.owner.query(
      "update consent set status = 'withdrawn' where client_id = $1 and purpose = 'participation'",
      [h.clientId(19)],
    );
    const res = await h.call('POST', `/api/reports/${id}/deliver`, SEEDED.owner, {
      contactId,
      channel: 'email',
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'no_consent' });
  });

  it('refuses to send a draft', async () => {
    const id = await draftFor(0);
    const contactId = await contactOf(0);
    await h.owner.query('update contact set can_receive_reports = true where id = $1', [contactId]);
    const res = await h.call('POST', `/api/reports/${id}/deliver`, SEEDED.owner, {
      contactId,
      channel: 'email',
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'not_issued' });
  });

  it('refuses a contact of another household', async () => {
    const id = await issued(1);
    const other = await contactOf(2);
    const res = await h.call('POST', `/api/reports/${id}/deliver`, SEEDED.owner, {
      contactId: other,
      channel: 'email',
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'contact_not_found' });
  });
});
