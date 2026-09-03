import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  canActivate,
  canTransition,
  canViewClient,
  type ClientStatus,
} from '../../../domain/client';
import { hasRole, isoDateIn } from '../../../domain/shared';
import { logRead } from '../_middleware/audit';
import { cleanText } from '../_middleware/text';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { canWriteClientRecord } from './access';
import { rejectedFields } from './bad-request';
import { captureEmiratesId, emiratesIdInUse } from './emirates-id-capture';
import {
  ClientRecordResponse,
  CreateClientBody,
  CreateClientResponse,
  IdResponse,
  StatusChangeBody,
  UpdateClientBody,
  type Consent,
  type Contact,
  type Goal,
  type Location,
} from './record-schema';
import { logRefused } from './refused';

/**
 * The client record itself: read the whole aggregate, create a lead, edit
 * demographics, and move it through its lifecycle
 * (docs/SPEC/client-record.md sections 3 and 4; "Client Record Plan" PR 2).
 */

const Params = z.object({ id: z.uuid() });

// Every date this module judges is the practice's own day, not the server's:
// a request at 22:00 UTC is already tomorrow in Dubai, and the activation
// gate must agree with the day sheet about which day that is (list.ts keeps
// the same constant for the same reason).
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

type ClientRow = {
  id: string;
  mrn: string;
  given_name: string;
  family_name: string;
  given_name_ar: string | null;
  family_name_ar: string | null;
  date_of_birth: string | null;
  sex_at_birth: 'female' | 'male' | 'unknown' | null;
  preferred_locale: 'en' | 'ar';
  referral_source: string | null;
  status: ClientRecordResponse['status'];
};

type ContactRow = {
  id: string;
  given_name: string | null;
  family_name: string | null;
  given_name_ar: string | null;
  family_name_ar: string | null;
  relationship: Contact['relationship'];
  is_legal_guardian: boolean;
  can_consent: boolean;
  can_receive_reports: boolean;
  can_pay: boolean;
  phone: string | null;
  email: string | null;
  whatsapp_opt_in: boolean;
  has_emirates_id: boolean;
};

type LocationRow = {
  id: string;
  label: Location['label'];
  emirate: Location['emirate'];
  makani_number: string | null;
  entrance_lng: number;
  entrance_lat: number;
  has_parking_point: boolean;
  has_community_gate: boolean;
  display_address: string | null;
  access_notes: string | null;
  is_primary: boolean;
};

type ConsentRow = {
  id: string;
  purpose: Consent['purpose'];
  status: Consent['status'];
  given_by_contact_id: string;
  given_at: Date;
  withdrawn_at: Date | null;
  expires_at: Date | null;
  method: Consent['method'];
  signature_document_id: string | null;
};

type GoalRow = {
  id: string;
  category_id: string;
  category_code: string;
  description: string;
  set_at: Date;
  status: Goal['status'];
  is_primary: boolean;
};

async function loadRecord(db: Db, clientId: string): Promise<ClientRecordResponse | null> {
  const client = await db.query<ClientRow>(
    'select id, mrn, given_name, family_name, given_name_ar, family_name_ar, date_of_birth, ' +
      'sex_at_birth, preferred_locale, referral_source, status from client where id = $1',
    [clientId],
  );
  const row = client.rows[0];
  if (!row) return null;

  const contacts = await db.query<ContactRow>(
    'select id, given_name, family_name, given_name_ar, family_name_ar, relationship, ' +
      'is_legal_guardian, can_consent, can_receive_reports, can_pay, ' +
      'phone, email, whatsapp_opt_in, (emirates_id_hash is not null) as has_emirates_id ' +
      'from contact where client_id = $1 order by created_at',
    [clientId],
  );
  const locations = await db.query<LocationRow>(
    'select id, label, emirate, makani_number, ' +
      'extensions.st_x(entrance_point::extensions.geometry) as entrance_lng, ' +
      'extensions.st_y(entrance_point::extensions.geometry) as entrance_lat, ' +
      '(parking_point is not null) as has_parking_point, ' +
      '(community_gate is not null) as has_community_gate, ' +
      'display_address, access_notes, is_primary ' +
      'from location where owner_type = $2 and owner_id = $1 order by is_primary desc, created_at',
    [clientId, 'client'],
  );
  const consents = await db.query<ConsentRow>(
    'select id, purpose, status, given_by_contact_id, given_at, withdrawn_at, expires_at, ' +
      'method, signature_document_id from consent where client_id = $1 order by created_at desc',
    [clientId],
  );
  const goals = await db.query<GoalRow>(
    'select g.id, g.category_id, gc.code as category_code, g.description, g.set_at, g.status, ' +
      'g.is_primary from goal g join goal_category gc on gc.id = g.category_id ' +
      'where g.client_id = $1 order by g.is_primary desc, g.set_at desc',
    [clientId],
  );

  return ClientRecordResponse.parse({
    id: row.id,
    mrn: row.mrn,
    givenName: row.given_name,
    familyName: row.family_name,
    givenNameAr: row.given_name_ar,
    familyNameAr: row.family_name_ar,
    dateOfBirth: row.date_of_birth,
    sexAtBirth: row.sex_at_birth,
    preferredLocale: row.preferred_locale,
    referralSource: row.referral_source,
    status: row.status,
    contacts: contacts.rows.map((c) => ({
      id: c.id,
      givenName: c.given_name,
      familyName: c.family_name,
      givenNameAr: c.given_name_ar,
      familyNameAr: c.family_name_ar,
      relationship: c.relationship,
      isLegalGuardian: c.is_legal_guardian,
      canConsent: c.can_consent,
      canReceiveReports: c.can_receive_reports,
      canPay: c.can_pay,
      phone: c.phone,
      email: c.email,
      whatsappOptIn: c.whatsapp_opt_in,
      hasEmiratesId: c.has_emirates_id,
    })),
    locations: locations.rows.map((l) => ({
      id: l.id,
      label: l.label,
      emirate: l.emirate,
      makaniNumber: l.makani_number,
      entranceLng: l.entrance_lng,
      entranceLat: l.entrance_lat,
      hasParkingPoint: l.has_parking_point,
      hasCommunityGate: l.has_community_gate,
      displayAddress: l.display_address,
      accessNotes: l.access_notes,
      isPrimary: l.is_primary,
    })),
    consents: consents.rows.map((c) => ({
      id: c.id,
      purpose: c.purpose,
      status: c.status,
      givenByContactId: c.given_by_contact_id,
      givenAt: c.given_at.toISOString(),
      withdrawnAt: c.withdrawn_at ? c.withdrawn_at.toISOString() : null,
      expiresAt: c.expires_at ? c.expires_at.toISOString() : null,
      method: c.method,
      signatureDocumentId: c.signature_document_id,
    })),
    goals: goals.rows.map((g) => ({
      id: g.id,
      categoryId: g.category_id,
      categoryCode: g.category_code,
      description: g.description,
      setAt: g.set_at.toISOString(),
      status: g.status,
      isPrimary: g.is_primary,
    })),
  });
}

export function mountClientRecordCore(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/clients/:id', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = Params.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;

    // app.client_status_for (db/migrations/100_client_record.sql) is security definer,
    // so it answers regardless of row level security: this is what lets canViewClient's
    // erased-record door (client-record.md sections 2 and 8) tell "no such client" (404,
    // unlogged) apart from "a client row security would otherwise hide from this role"
    // (403, logged) — a plain select under RLS collapses both into an empty result, which
    // is exactly the bug this route had (issue 13/14 of the third review round). Tenant
    // scoped inside the function itself, so a status coming back at all means it is this
    // actor's own tenant.
    const statusRow = await db.query<{ status: ClientStatus | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    // canViewClient's client_contact branch checks ctx.contactClientIds, which only this
    // route knows how to resolve: the clients their own contact rows point at. Read under
    // row security as the caller, so this never sees another practice's contacts.
    const contactClientIds = hasRole(actor, 'client_contact')
      ? (
          await db.query<{ client_id: string }>(
            'select client_id from contact where user_id = $1',
            [actor.userId],
          )
        ).rows.map((r) => r.client_id)
      : [];
    // And its practitioner branch checks ctx.scheduledClientIds. This asks the database
    // the same question the row policies ask, rather than keeping a second copy of the
    // rule here: app.client_visible_to_practitioner is what six restrictive read
    // policies call, so the API and the policies cannot disagree about who is on whose
    // schedule. It answered false for everyone while no schedule existed; migration 201
    // (the scheduling stream) gives it the real window, and the moment it does, a
    // practitioner holding a visit with this client would otherwise have been refused by
    // this route and audited for it while the database was saying yes
    // (docs/CHANGE-REQUESTS/scheduling-03.md item 3).
    //
    // Asked only for a practitioner, and only about the one client being opened: this is
    // an access check, not a list, and nothing else needs the answer.
    const scheduledClientIds =
      hasRole(actor, 'practitioner') &&
      (
        await db.query<{ visible: boolean }>(
          'select app.client_visible_to_practitioner($1) as visible',
          [clientId],
        )
      ).rows[0]?.visible === true
        ? [clientId]
        : [];
    const view = canViewClient(
      actor,
      { id: clientId, tenantId: actor.tenantId, status },
      { scheduledClientIds, contactClientIds },
      now(),
    );
    if (!view.ok) {
      // The status lookup above already proved this row exists, so a refusal here always
      // names a real row (client-record.md section 9; the third review round's fix).
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Opening an erased record is a sensitive action (client-record.md section 8), the
    // same gate as the timeline (app/api/audit/timeline.ts): checked before any read of
    // the record's own contents, not after loading it.
    if (view.needsReason && !(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const record = await loadRecord(db, clientId);
    if (!record) {
      // canViewClient already said yes for a row app.client_status_for just confirmed
      // exists; row security reading the same row the same way should never disagree.
      // If it ever does, that is the row vanishing between the two reads, not a refusal
      // to report — clients are never deleted, only erased, so this is unreached in
      // practice and stays a plain, unlogged not-found rather than a claim about access.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    await logRead(db, 'client', clientId, clientId);
    return c.json(record);
  });

  api.post('/api/clients', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canWriteClientRecord(actor, '', now())) {
      // A collection action, not a specific row: nothing here can name what was
      // refused (client-record.md section 9), so a fresh id stands in as the entity.
      // Deliberately not the request id: that comes from the caller's own
      // `x-request-id` header, and using it would let a signed-in actor mint an audit
      // row pointing at any uuid they chose. The request id still reaches the
      // `request_id` column from the transaction's setting, so correlation is unharmed.
      await logRefused(db, 'client', randomUUID(), null);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const bodyJson = await c.req.json().catch(() => null);
    const body = CreateClientBody.safeParse(bodyJson);
    if (!body.success) {
      return c.json({ error: 'bad_request', fields: rejectedFields(body.error), requestId }, 400);
    }

    const tenantId = actor.tenantId;
    // contactId is generated before either insert, both so the Emirates ID seal below can
    // bind to it (identity.ts's boundTo) and so a bad identity number is caught before the
    // client row is allocated an MRN at all — a lead with no contact, MRN spent for nothing,
    // is exactly the half-written row this ordering avoids.
    const contactId = randomUUID();
    const emiratesIdInput = body.data.contact.emiratesId;
    const capture =
      emiratesIdInput !== undefined
        ? captureEmiratesId(emiratesIdInput, contactId, c.get('identityKeys'))
        : null;
    if (capture && !capture.ok) {
      return capture.code === 'emirates_id_unavailable'
        ? c.json({ error: 'emirates_id_unavailable', requestId }, 503)
        : c.json({ error: 'bad_request', code: capture.code, requestId }, 400);
    }
    // Before a single row is written, so a repeated identity number costs neither a
    // half-made client nor a record number spent on nothing.
    if (capture && capture.ok && (await emiratesIdInUse(db, capture.hash))) {
      return c.json({ error: 'conflict', code: 'emirates_id_in_use', requestId }, 409);
    }

    // app.next_mrn (db/migrations/100_client_record.sql) takes its own advisory lock,
    // scoped to this tenant, and reads every client regardless of row level security —
    // including one this actor's role cannot see because it is erased — so the practice's
    // highest MRN is never missed just because the client who held it was later erased
    // (issue 12 of the third review round). The unique constraint on (tenant_id, mrn)
    // stays the backstop it always was.
    const nextMrnRow = await db.query<{ next_mrn: string }>('select app.next_mrn($1) as next_mrn', [
      tenantId,
    ]);
    const mrn = nextMrnRow.rows[0]?.next_mrn;
    if (!mrn) {
      throw new Error('app.next_mrn returned no value.');
    }

    const clientId = randomUUID();
    await db.query(
      'insert into client (id, tenant_id, mrn, given_name, family_name, given_name_ar, ' +
        'family_name_ar, date_of_birth, referral_source, status) ' +
        "values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'lead')",
      [
        clientId,
        tenantId,
        mrn,
        cleanText(body.data.givenName, 100),
        cleanText(body.data.familyName, 100),
        body.data.givenNameAr ? cleanText(body.data.givenNameAr, 100) : null,
        body.data.familyNameAr ? cleanText(body.data.familyNameAr, 100) : null,
        body.data.dateOfBirth ?? null,
        body.data.referralSource ? cleanText(body.data.referralSource, 200) : null,
      ],
    );
    await db.query(
      'insert into contact (id, tenant_id, client_id, given_name, family_name, ' +
        'given_name_ar, family_name_ar, relationship, is_legal_guardian, ' +
        'can_consent, can_receive_reports, can_pay, phone, email, emirates_id_encrypted, ' +
        'emirates_id_hash) ' +
        'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)',
      [
        contactId,
        tenantId,
        clientId,
        body.data.contact.givenName ? cleanText(body.data.contact.givenName, 100) : null,
        body.data.contact.familyName ? cleanText(body.data.contact.familyName, 100) : null,
        body.data.contact.givenNameAr ? cleanText(body.data.contact.givenNameAr, 100) : null,
        body.data.contact.familyNameAr ? cleanText(body.data.contact.familyNameAr, 100) : null,
        body.data.contact.relationship,
        body.data.contact.isLegalGuardian,
        body.data.contact.canConsent,
        body.data.contact.canReceiveReports,
        body.data.contact.canPay,
        body.data.contact.phone,
        body.data.contact.email ?? null,
        capture && capture.ok ? capture.sealed : null,
        capture && capture.ok ? capture.hash : null,
      ],
    );
    await db.query('update client set primary_contact_id = $1 where id = $2', [
      contactId,
      clientId,
    ]);

    return c.json(CreateClientResponse.parse({ id: clientId, mrn }), 201);
  });

  api.patch('/api/clients/:id', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = Params.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = UpdateClientBody.safeParse(bodyJson);
    if (!body.success) {
      return c.json({ error: 'bad_request', fields: rejectedFields(body.error), requestId }, 400);
    }

    // Existence first, role second, and existence goes through
    // app.client_status_for (security definer) rather than a plain select: a plain
    // select is gated by db/policies/client/readers.sql, which a role with no write
    // access here may also lack read access to (a practitioner reads no client at all
    // while the scheduling door is shut) — that would turn an existing row into a false
    // not_found rather than the forbidden it should be. A 404 here therefore always means
    // no such row and is never logged; a 403 that follows always names a row confirmed to
    // exist (client-record.md section 9, third review round issue 13).
    const statusRow = await db.query<{ status: ClientRow['status'] | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const status = statusRow.rows[0]?.status ?? null;
    if (status === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Erased is read-only (client-record.md section 3): writers.sql would silently
    // update nothing, since RLS filters the row out of an UPDATE rather than raising.
    if (status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    const d = body.data;
    if (d.givenName !== undefined) push('given_name', cleanText(d.givenName, 100));
    if (d.familyName !== undefined) push('family_name', cleanText(d.familyName, 100));
    if (d.givenNameAr !== undefined)
      push('given_name_ar', d.givenNameAr ? cleanText(d.givenNameAr, 100) : null);
    if (d.familyNameAr !== undefined)
      push('family_name_ar', d.familyNameAr ? cleanText(d.familyNameAr, 100) : null);
    if (d.dateOfBirth !== undefined) push('date_of_birth', d.dateOfBirth);
    if (d.sexAtBirth !== undefined) push('sex_at_birth', d.sexAtBirth);
    if (d.referralSource !== undefined)
      push('referral_source', d.referralSource ? cleanText(d.referralSource, 200) : null);
    if (sets.length === 0) return c.json({ error: 'bad_request', requestId }, 400);

    values.push(clientId);
    await db.query(`update client set ${sets.join(', ')} where id = $${values.length}`, values);
    return c.json(IdResponse.parse({ id: clientId }));
  });

  api.post('/api/clients/:id/status', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = Params.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = StatusChangeBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    // Existence (via app.client_status_for, which bypasses row level security) before
    // role, for the same reason record.ts's PATCH route does it this way: a plain select
    // could turn an existing row into a false not_found for a role that cannot read it
    // either, which would wrongly skip the audit row a real refusal owes (issue 13).
    const statusRow = await db.query<{ status: ClientRow['status'] | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const currentStatus = statusRow.rows[0]?.status ?? null;
    if (currentStatus === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const current = { status: currentStatus };
    if (!canTransition(current.status, body.data.to)) {
      return c.json({ error: 'invalid_transition', requestId }, 400);
    }
    // Reactivation from closed is a sensitive action (client-record.md section 9).
    if (current.status === 'closed' && !(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    if (body.data.to === 'active') {
      const record = await loadRecord(db, clientId);
      if (!record) {
        // Already confirmed to exist above; row security reading it the ordinary way
        // should never disagree. See the same fallback on GET /api/clients/:id.
        return c.json({ error: 'not_found', requestId }, 404);
      }
      const gate = canActivate(
        {
          client: { id: record.id, status: current.status, dateOfBirth: record.dateOfBirth },
          contacts: record.contacts.map((ct) => ({
            id: ct.id,
            relationship: ct.relationship,
            isLegalGuardian: ct.isLegalGuardian,
            canConsent: ct.canConsent,
            userId: null,
          })),
          locations: record.locations.map((l) => ({
            id: l.id,
            emirate: l.emirate,
            hasVerifiedPin: true,
            label: l.label,
            isPrimary: l.isPrimary,
          })),
          consents: record.consents.map((cs) => ({
            purpose: cs.purpose,
            status: cs.status,
            givenByContactId: cs.givenByContactId,
            givenAt: cs.givenAt,
            expiresAt: cs.expiresAt,
          })),
        },
        // The injected clock, in the practice's own time zone: this route takes `now`
        // like every other, and reading Date directly here would make the one gate that
        // decides activation the one thing a test cannot pin.
        isoDateIn(now(), PRACTICE_TIME_ZONE),
      );
      if (!gate.ok) {
        return c.json({ error: 'incomplete', missing: gate.missing, requestId }, 400);
      }
    }
    await db.query('update client set status = $1 where id = $2', [body.data.to, clientId]);
    return c.json(IdResponse.parse({ id: clientId }));
  });
}
