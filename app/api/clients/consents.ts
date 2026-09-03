import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  CONSENT_SCAN_KIND,
  CONSENT_SIGNATURE_KIND,
  canGiveConsent,
  type ConsentPurpose,
} from '../../../domain/client';
import { isoDateIn } from '../../../domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { canWriteClientRecord } from './access';
import { currentWording } from './consent-wording';
import { fileClientDocument } from './document-store';
import {
  IdResponse,
  RecordConsentBody,
  WithdrawConsentResponse,
  type DocumentBytes,
} from './record-schema';
import { logRefused } from './refused';
import { retirePhotoEvidence } from './withdrawal';

/**
 * Recording and withdrawing consent (docs/SPEC/client-record.md sections 2
 * and 7).
 *
 * The third pull request left this route unable to record anything a person
 * had actually signed: it took a `textDocumentId` but no evidence, so every
 * method it accepted attested to something nothing could file
 * (docs/CHANGE-REQUESTS/client-record-02.md, "What the fourth pull request
 * must add"). It now takes the evidence with the consent and files both in one
 * unit of work — the bytes through the storage seam, the `document` row
 * immutable, and `consent.signature_document_id` naming it.
 *
 * The refusals, and why each exists:
 *
 *   * **A wording that is not the current one.** A consent records the exact
 *     text shown, so recording one against a retired or superseded version
 *     would either be a lie about what was on screen or a screen showing
 *     yesterday's words. Both are refused by name so the console can say which.
 *   * **A wording of another purpose or language.** The wording for
 *     `home_visit` is not the wording for `participation`, and an Arabic
 *     speaker signs the Arabic text, not a summary of it
 *     (docs/CONSENT/README.md). The language is the client's own
 *     `preferred_locale`, never the console operator's.
 *   * **A contact who may not give it.** `canGiveConsent` in domain/client:
 *     the practice's `can_consent` flag always, and a legal guardian besides
 *     when the client is a minor or the purpose is a guardian's own. This is
 *     the same rule `canActivate` reads, so a consent that would fail
 *     activation is refused at the moment it is recorded rather than
 *     discovered at the gate.
 *   * **Evidence that does not match the method.** `app_signature` is a PNG
 *     the pad rendered; `paper_scan` is a photograph or a PDF;
 *     `verbal_witnessed` carries none and is only ever a `home_visit`
 *     re-confirmation (section 7).
 *
 * Withdrawal needs a reason and takes effect immediately (section 7). This
 * route does not cancel future appointments — that is scheduling's, and
 * docs/CHANGE-REQUESTS/client-record-03.md asks for it.
 */

const ClientParams = z.object({ id: z.uuid() });
const ConsentParams = z.object({ id: z.uuid(), consentId: z.uuid() });

/** The practice's own day, so a client turning eighteen changes the answer when Dubai says so. */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

type WordingCheck =
  | { ok: true }
  | { ok: false; code: 'wording_not_found' | 'wording_retired' | 'wording_superseded' }
  | { ok: false; code: 'wording_wrong_purpose' | 'wording_wrong_locale' };

type WordingRow = {
  id: string;
  kind: string;
  client_id: string | null;
  purpose: string | null;
  locale: string | null;
  retired_at: Date | null;
};

/**
 * Whether `textDocumentId` names the wording this consent may point at.
 *
 * `client_id is null` was already the rule and stays: `consent.text_document_id`
 * is the practice's own published wording, never a copy of what somebody else
 * once signed. What is new is everything after it.
 */
async function checkWording(
  db: Db,
  textDocumentId: string,
  purpose: ConsentPurpose,
  locale: string,
): Promise<WordingCheck> {
  const { rows } = await db.query<WordingRow>(
    'select id, kind, client_id, purpose, locale, retired_at from document where id = $1',
    [textDocumentId],
  );
  const row = rows[0];
  if (!row || row.client_id !== null || row.kind !== 'consent_text') {
    return { ok: false, code: 'wording_not_found' };
  }
  if (row.retired_at !== null) {
    return { ok: false, code: 'wording_retired' };
  }
  if (row.purpose !== purpose) {
    return { ok: false, code: 'wording_wrong_purpose' };
  }
  if (row.locale !== locale) {
    return { ok: false, code: 'wording_wrong_locale' };
  }
  // Not retired and of the right purpose and language, but not the version the
  // practice would show today: a draft with an approved version beside it, or
  // an older draft. `currentWording` is the same question the wording route
  // answers, asked once so the two can never disagree.
  const current = await currentWording(db, purpose, locale);
  if (!current || current.id !== row.id) {
    return { ok: false, code: 'wording_superseded' };
  }
  return { ok: true };
}

type EvidenceCheck =
  | { ok: true; file: DocumentBytes; kind: string }
  | { ok: true; file: null; kind: null }
  | { ok: false; code: 'evidence_required' | 'evidence_not_accepted' };

/** What each method must arrive with (docs/SPEC/client-record.md section 7). */
function checkEvidence(
  method: 'app_signature' | 'paper_scan' | 'verbal_witnessed',
  purpose: ConsentPurpose,
  evidence: DocumentBytes | undefined,
): EvidenceCheck {
  if (method === 'verbal_witnessed') {
    // Never how initial participation is recorded: a re-confirmation of a home
    // visit and nothing else.
    if (purpose !== 'home_visit') return { ok: false, code: 'evidence_not_accepted' };
    // Nothing to file. A body carrying bytes for this method is a caller
    // confused about what it is recording, so it is refused rather than
    // quietly dropped.
    if (evidence) return { ok: false, code: 'evidence_not_accepted' };
    return { ok: true, file: null, kind: null };
  }
  if (!evidence) return { ok: false, code: 'evidence_required' };
  if (method === 'app_signature') {
    // The pad renders a PNG at a fixed size and nothing else does; a JPEG here
    // means the bytes did not come from the pad.
    if (evidence.mimeType !== 'image/png') return { ok: false, code: 'evidence_not_accepted' };
    return { ok: true, file: evidence, kind: CONSENT_SIGNATURE_KIND };
  }
  // paper_scan: a photograph of the signed form, or a PDF of it. The four
  // types the platform holds are the schema's own enum; all are acceptable
  // here.
  return { ok: true, file: evidence, kind: CONSENT_SCAN_KIND };
}

export function mountConsents(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/clients/:id/consents', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = RecordConsentBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    // app.client_status_for bypasses row level security: see app/api/clients/contacts.ts
    // for why this must come before the role check (issue 13, third review round).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Erased is read-only (client-record.md section 3): writers.sql would refuse the
    // insert outright; this gives the caller a clean reason rather than a raw RLS error.
    if (clientStatus === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }

    // The client's own language and age, read under row security as the caller:
    // the wording must be the one this person reads, and whether a guardian is
    // required is a fact about this client, not about who is typing.
    const clientRow = await db.query<{ preferred_locale: string; date_of_birth: string | null }>(
      'select preferred_locale, date_of_birth from client where id = $1',
      [clientId],
    );
    const client = clientRow.rows[0];
    if (!client) {
      // Confirmed to exist a moment ago by app.client_status_for; row security
      // reading it the ordinary way should never disagree.
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const wording = await checkWording(
      db,
      body.data.textDocumentId,
      body.data.purpose,
      client.preferred_locale,
    );
    if (!wording.ok) {
      return c.json({ error: 'bad_request', code: wording.code, requestId }, 400);
    }

    const contact = await db.query<{
      id: string;
      can_consent: boolean;
      is_legal_guardian: boolean;
    }>('select id, can_consent, is_legal_guardian from contact where id = $1 and client_id = $2', [
      body.data.givenByContactId,
      clientId,
    ]);
    const giver = contact.rows[0];
    if (!giver) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const permitted = canGiveConsent(
      { dateOfBirth: client.date_of_birth },
      {
        id: giver.id,
        canConsent: giver.can_consent,
        isLegalGuardian: giver.is_legal_guardian,
      },
      body.data.purpose,
      isoDateIn(now(), PRACTICE_TIME_ZONE),
    );
    if (!permitted.ok) {
      return c.json({ error: 'bad_request', code: permitted.reason, requestId }, 400);
    }

    const evidence = checkEvidence(body.data.method, body.data.purpose, body.data.evidence);
    if (!evidence.ok) {
      return c.json({ error: 'bad_request', code: evidence.code, requestId }, 400);
    }

    // Bytes into the store and the document row that names them, before the
    // consent that points at it: a consent whose evidence failed to file must
    // not exist at all, and the whole request is one transaction, so a refusal
    // here leaves neither row (docs/SEAMS.md, trunk-notes round 14 item 3).
    let signatureDocumentId: string | null = null;
    if (evidence.file) {
      const filed = await fileClientDocument(db, c.get('storage'), actor, {
        clientId,
        kind: evidence.kind,
        file: evidence.file,
        // Immutable: this is the evidence of what a person was shown and
        // agreed to, and migration 903 makes that mean the row is neither
        // changed nor deleted outside an erasure.
        isImmutable: true,
        now: now(),
      });
      if (!filed.ok) {
        return filed.reason === 'storage_unavailable'
          ? c.json({ error: 'storage_unavailable', requestId }, 503)
          : c.json({ error: 'bad_request', code: filed.reason, requestId }, 400);
      }
      signatureDocumentId = filed.document.id;
    }

    // A purpose has one live answer. Recording a new consent supersedes the
    // active one it replaces rather than leaving two rows both saying yes —
    // `superseded` is in the status enum for exactly this, and `canActivate`
    // and every session-start check read "active" without asking which.
    // Withdrawn rows are left alone: a withdrawal is a thing a person did and
    // is not tidied away by the next signature.
    await db.query(
      "update consent set status = 'superseded' where client_id = $1 and purpose = $2 " +
        "and status = 'active'",
      [clientId, body.data.purpose],
    );

    const consentId = randomUUID();
    await db.query(
      'insert into consent (id, tenant_id, client_id, given_by_contact_id, purpose, version, ' +
        'text_document_id, method, expires_at, signature_document_id) ' +
        'values ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9)',
      [
        consentId,
        actor.tenantId,
        clientId,
        body.data.givenByContactId,
        body.data.purpose,
        body.data.textDocumentId,
        body.data.method,
        body.data.expiresAt ?? null,
        signatureDocumentId,
      ],
    );
    return c.json(IdResponse.parse({ id: consentId }), 201);
  });

  api.post('/api/clients/:id/consents/:consentId/withdraw', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ConsentParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { id: clientId, consentId } = params.data;

    // Client existence (bypassing row level security) before role, then the reason
    // prompt, then the consent itself — the same ordering as the record route above
    // (issue 13, third review round).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Withdrawal is a sensitive action and always needs a reason (section 9).
    if (!(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    if (clientStatus === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    const existing = await db.query<{ id: string; status: string; purpose: ConsentPurpose }>(
      'select id, status, purpose from consent where id = $1 and client_id = $2',
      [consentId, clientId],
    );
    const row = existing.rows[0];
    if (!row) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (row.status !== 'active') {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    await db.query("update consent set status = 'withdrawn', withdrawn_at = now() where id = $1", [
      consentId,
    ]);

    // Withdrawing photo_video is the permission to hold a setup photograph
    // being taken back, so the photographs go with it (./withdrawal.ts
    // explains what "go" can and cannot mean today). The counts travel back so
    // the console can say what happened rather than imply it.
    const photographs =
      row.purpose === 'photo_video'
        ? await retirePhotoEvidence(db, c.get('storage'), clientId)
        : { removed: 0, stillOnFile: 0 };
    return c.json(
      WithdrawConsentResponse.parse({
        id: consentId,
        photographsRemoved: photographs.removed,
        photographsStillOnFile: photographs.stillOnFile,
      }),
    );
  });
}
