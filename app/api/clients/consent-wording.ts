import type { Hono } from 'hono';
import { z } from 'zod';
import { CONSENT_PURPOSES } from '../../../domain/client';
import { hasRole } from '../../../domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { signedDocumentLink } from './document-store';
import { ConsentWordingResponse } from './record-schema';

/**
 * The wording a person is shown before they agree to anything
 * (docs/SPEC/client-record.md section 7, docs/CONSENT/README.md).
 *
 * A consent records the exact document version shown
 * (`consent.text_document_id`), so a screen has to be able to name one. Until
 * this route, the browser had no way to: the wording documents are practice
 * documents (`client_id` null) and nothing listed them, which is the first of
 * the three things docs/CHANGE-REQUESTS/client-record-02.md asked the fourth
 * pull request to add.
 *
 * **Which wording is the current one.** The approved version if the practice
 * has one, and otherwise the latest draft, and the answer always says which:
 * `status` is on the response and the screen shows a draft line above the pad
 * (docs/CONSENT/README.md — every wording is a draft until the practice's
 * lawyer approves it, and the person signing is told so). Retired versions are
 * excluded outright: `retired_at` is what the practice sets when a newer
 * version replaces one, and migration 902's partial unique index already
 * guarantees at most one approved, non-retired wording per purpose and
 * language, so "the approved one" is never ambiguous. Among drafts the latest
 * is the most recently filed, tie-broken by version descending — a version
 * string is the wording file's own front matter (`0.1-draft`) and not a
 * number this platform may assume the shape of, so recency leads and the
 * string only breaks a tie.
 *
 * **The text is not in this answer.** It comes back as `textUrl`, a signed
 * link good for five minutes through the storage seam, for the reason
 * docs/SEAMS.md gives: bytes are the store's to hand out, never a route's. It
 * also keeps the wording out of the audit trail — `auditDocumentRead` records
 * that this actor opened this document, and the words themselves are never a
 * payload.
 *
 * **Who may read it.** Every staff role, and a client contact, whose claim is
 * the strongest of all: a person is entitled to a copy of what they agreed to.
 * The floor under that is db/policies/client/readers.sql, which this pull
 * request extends for exactly this (round 14's trunk note 6); the role list
 * here is the courtesy above it.
 */

const Query = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  locale: z.enum(['en', 'ar']),
});

type WordingRow = {
  id: string;
  purpose: string;
  locale: 'en' | 'ar';
  version: string;
  status: 'draft' | 'approved';
  mime_type: string;
  storage_key: string;
};

/**
 * The current wording for a purpose and language, or null. Exported because
 * the record-consent route asks the same question of a document the caller
 * named, and the two must not disagree about what "current" means.
 */
export async function currentWording(
  db: Db,
  purpose: string,
  locale: string,
): Promise<WordingRow | null> {
  const { rows } = await db.query<WordingRow>(
    'select id, purpose, locale, version, status, mime_type, storage_key from document ' +
      "where kind = 'consent_text' and purpose = $1 and locale = $2 and retired_at is null " +
      "order by (status = 'approved') desc, created_at desc, version desc limit 1",
    [purpose, locale],
  );
  return rows[0] ?? null;
}

export function mountConsentWording(api: Hono<ApiEnv>): void {
  api.get('/api/clients/consent-wording', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const query = Query.safeParse(c.req.query());
    if (!query.success) return c.json({ error: 'bad_request', requestId }, 400);
    // Finance is the one role with no business here: it reads demographics and
    // contacts and never a consent (docs/SPEC/client-record.md section 2), and
    // the read policy refuses the row underneath this in any case.
    if (!hasRole(actor, 'owner', 'admin', 'lead_practitioner', 'practitioner', 'client_contact')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }

    const wording = await currentWording(db, query.data.purpose, query.data.locale);
    if (!wording) {
      // No wording on file for that purpose in that language. A plain
      // not-found: the practice has not published one, which is a state the
      // console shows rather than an error it hides.
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const link = await signedDocumentLink(db, storage, {
      id: wording.id,
      // A practice document has no client, and null is the honest answer in
      // the audit row rather than an invented one.
      clientId: null,
      storageKey: wording.storage_key,
    });

    return c.json(
      ConsentWordingResponse.parse({
        id: wording.id,
        purpose: wording.purpose,
        locale: wording.locale,
        version: wording.version,
        status: wording.status,
        mimeType: wording.mime_type,
        textUrl: link.url,
        expiresInSeconds: link.expiresInSeconds,
      }),
    );
  });
}
