import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { renderDocument, type MoneyDocument } from '../../../domain/billing/document';
import {
  draftMessage,
  whatsAppHandoff,
  type DocumentSender,
  type SendOutcome,
} from '../../../domain/billing/sending';
import {
  clientDocumentKey,
  documentRetentionUntil,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
} from '../../../domain/shared/storage';
import { auditDocumentRead } from '../_middleware/storage/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { mayReadInvoices } from './access';
import { logSensitiveAction } from './audit';
import {
  CreateDocumentInput,
  CreateDocumentResponse,
  DocumentLinkResponse,
  SendDocumentInput,
  SendDocumentResponse,
} from './document-schema';
import { invoiceDocument, receiptDocument } from './document-source';
import { documentFonts } from './fonts';
import { isUuid } from './ids';
import { documentSender } from './sending';

/**
 * `POST /api/billing/documents` — render an invoice or a receipt and file it.
 * `GET /api/billing/documents/:id/link` — a short-lived link that opens it.
 *
 * **Two routes, because they are two different acts.** One writes a document
 * into the practice's filing and the other hands somebody the means to open a
 * client's file — which is a read, and is audited as one whether or not the
 * bytes are ever fetched (docs/SEAMS.md, `auditDocumentRead`).
 *
 * **Filed once.** A document is immutable, so a second request for the same
 * invoice finds the first and returns it rather than rendering a second
 * document with the same number on it. `app.file_billing_document` enforces
 * that under two unique indexes, not on this route's good manners.
 *
 * **The bytes go to the store after the commit.** The transaction writes the
 * `document` row; `c.get('afterCommit')` writes the bytes. A store cannot be
 * rolled back and a transaction can, so a route that wrote bytes inside its own
 * transaction would leave them behind whenever anything downstream failed —
 * unreachable, since nothing would name their key. The fence runs registered
 * work only on a commit, and the middleware awaits it before the response
 * leaves, so a caller that is told the document exists is told the truth.
 *
 * **The hash.** The seam's contract is that `put` answers the sha256 of the
 * bytes as written (`domain/shared/storage.ts`), and that is what
 * `document.sha256` must hold. The row goes in before the put runs, so the hash
 * is taken over exactly the bytes handed to the seam and the put's own answer is
 * checked against it — a disagreement means the store did not write what it was
 * given, and it is logged with the request id and nothing else.
 *
 * **What the other half of the story is.** Rendering is deterministic
 * (`domain/billing/document`): the same row always produces the same bytes. So a
 * put that never ran — the store was down for that moment — is recoverable, and
 * the link route below recovers it, rather than leaving a row pointing at
 * nothing for ever.
 */

const KIND_SQL =
  'select bd.id, bd.kind, bd.client_id, bd.document_id, d.storage_key, d.sha256, ' +
  'coalesce(i.reference, p.receipt_reference) as reference ' +
  'from billing_document bd join document d on d.id = bd.document_id ' +
  'left join invoice i on i.id = bd.invoice_id ' +
  'left join payment p on p.id = bd.payment_id ' +
  'where bd.tenant_id = app.current_tenant_id() and bd.document_id = $1';

const EXISTING_SQL =
  'select document_id from billing_document where tenant_id = app.current_tenant_id() ' +
  "and ((kind = 'invoice' and invoice_id = $1) or (kind = 'receipt' and payment_id = $1))";

type FiledRow = {
  id: string;
  kind: 'invoice' | 'receipt';
  client_id: string;
  document_id: string;
  storage_key: string;
  /** The fingerprint of the bytes that were filed. A re-render must match it. */
  sha256: Buffer;
  reference: string | null;
};

/** The bytes for a document, from the rows it was written from. */
async function sourceFor(
  db: Db,
  input: CreateDocumentInput,
): Promise<{ document: MoneyDocument; clientId: string; sourceId: string } | null> {
  if (input.invoiceId) {
    const found = await invoiceDocument(db, input.invoiceId);
    return found ? { ...found, sourceId: input.invoiceId } : null;
  }
  if (input.paymentId) {
    const found = await receiptDocument(db, input.paymentId);
    return found ? { ...found, sourceId: input.paymentId } : null;
  }
  return null;
}

export function mountDocuments(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/billing/documents', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    // Rendering shows what the invoice already says, to somebody who may
    // already read it. The audience is the invoice book's, and no wider.
    if (!mayReadInvoices(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const storage = c.get('storage');
    if (!storage) {
      // A deployment with no document store configured is refused cleanly
      // rather than assumed away (docs/CHANGE-REQUESTS/trunk-notes.md).
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    const body = CreateDocumentInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    const sourceId = body.data.invoiceId ?? body.data.paymentId ?? '';

    // Already rendered: the same document, not a second one.
    const already = await db.query<{ document_id: string }>(EXISTING_SQL, [sourceId]);
    const filed = already.rows[0]?.document_id;
    if (filed) {
      const row = await db.query<FiledRow>(KIND_SQL, [filed]);
      const found = row.rows[0];
      if (found) {
        return c.json(
          CreateDocumentResponse.parse({
            document: {
              id: found.document_id,
              kind: found.kind,
              reference: found.reference ?? '',
              clientId: found.client_id,
            },
          }),
          200,
        );
      }
    }

    const source = await sourceFor(db, body.data);
    if (!source) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const bytes = renderDocument(source.document, documentFonts());
    const documentId = randomUUID();
    const key = clientDocumentKey(actor.tenantId, source.clientId, documentId);
    const sha256 = createHash('sha256').update(bytes).digest();
    const kind = source.document.kind;
    // Five years, computed by the one piece of arithmetic that decides it
    // (domain/shared/storage.ts). A financial record keeps five years whatever
    // else happens to the client's file (CLAUDE.md rule 8).
    const retentionUntil = documentRetentionUntil(kind, now());

    // The id the *function* settled on, which is not always the one just
    // generated: a second request racing the first finds its row and is handed
    // that document back. Answering the generated id there would name a
    // document no row carries and would put bytes under a key nothing points at.
    const filedRow = await db.query<{ document_id: string }>(
      'select app.file_billing_document($1::billing_document_kind, $2, $3, $4, $5, $6) ' +
        'as document_id',
      [kind, source.sourceId, documentId, key, sha256, retentionUntil],
    );
    const filedId = filedRow.rows[0]?.document_id;
    if (!filedId) {
      throw new Error('Filing a billing document did not return an id.');
    }
    if (filedId !== documentId) {
      // The other request won. Its document is the document; nothing of this
      // request's is written, and no bytes are put under a key it invented.
      const existing = await db.query<FiledRow>(KIND_SQL, [filedId]);
      const found = existing.rows[0];
      return c.json(
        CreateDocumentResponse.parse({
          document: {
            id: filedId,
            kind: found?.kind ?? kind,
            reference: found?.reference ?? source.document.reference,
            clientId: source.clientId,
          },
        }),
        200,
      );
    }

    c.get('afterCommit')(async () => {
      const stored = await storage.put(key, bytes, 'application/pdf');
      if (stored.sha256 !== sha256.toString('hex')) {
        // The store did not write what it was handed. Never the key and never
        // the hash: both name a client's document.
        console.error(JSON.stringify({ requestId, after: 'commit', name: 'DocumentHashMismatch' }));
      }
    });

    return c.json(
      CreateDocumentResponse.parse({
        document: {
          id: documentId,
          kind,
          reference: source.document.reference,
          clientId: source.clientId,
        },
      }),
      201,
    );
  });

  api.get('/api/billing/documents/:id/link', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayReadInvoices(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const documentId = c.req.param('id');
    if (!isUuid(documentId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }

    const db = c.get('db');
    const found = await db.query<FiledRow>(KIND_SQL, [documentId]);
    const row = found.rows[0];
    if (!row) {
      // Row security decides which rows this actor can see, so a document of
      // another practice's — or a client this person may not read — is simply
      // not there. A 404, never a 403 that confirms it exists.
      return c.json({ error: 'not_found', requestId }, 404);
    }

    // A put that never ran leaves a row pointing at bytes that are not there.
    // Rendering is deterministic, so the fix is to render the same document
    // again rather than to lose it — but only if it *is* the same document.
    //
    // The hash on the row is what decides. A re-render whose fingerprint differs
    // is not a repair: something the document was rendered from has moved since
    // it was filed, and writing the new bytes under the old row's key would
    // replace a filed financial document with a different one and leave the row
    // asserting a hash for bytes that no longer match it. So it is refused, and
    // the mismatch is logged with the request id and nothing else — a key and a
    // hash both name a client's document.
    if (!(await storage.exists(row.storage_key))) {
      const remade = await documentBehind(db, documentId, row.kind);
      if (!remade) {
        return c.json({ error: 'not_found', requestId }, 404);
      }
      const bytes = renderDocument(remade, documentFonts());
      if (createHash('sha256').update(bytes).digest('hex') !== row.sha256.toString('hex')) {
        console.error(
          JSON.stringify({ requestId, name: 'DocumentWouldNotMatchWhatWasFiled', documentId }),
        );
        return c.json({ error: 'conflict', code: 'document_bytes_differ', requestId }, 409);
      }
      c.get('afterCommit')(async () => {
        await storage.put(row.storage_key, bytes, 'application/pdf', { overwrite: true });
      });
    }

    // Handing somebody the means to open a client's file is the read worth
    // recording, and signing is the only moment it can be recorded
    // (docs/SEAMS.md). Before the link, every time.
    await auditDocumentRead(db, { id: documentId, clientId: row.client_id });

    const url = await storage.getSignedUrl(row.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS);
    return c.json(
      DocumentLinkResponse.parse({ url, expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS }),
    );
  });
}

const SOURCE_OF_DOCUMENT_SQL =
  'select invoice_id, payment_id from billing_document ' +
  'where tenant_id = app.current_tenant_id() and document_id = $1';

/**
 * The invoice or payment a filed document was rendered from, read back as a
 * document again. Only the link route needs this, and only to put back bytes
 * that never reached the store.
 */
async function documentBehind(
  db: Db,
  documentId: string,
  kind: 'invoice' | 'receipt',
): Promise<MoneyDocument | null> {
  const found = await db.query<{ invoice_id: string | null; payment_id: string | null }>(
    SOURCE_OF_DOCUMENT_SQL,
    [documentId],
  );
  const row = found.rows[0];
  if (!row) return null;
  if (kind === 'invoice') {
    return row.invoice_id ? ((await invoiceDocument(db, row.invoice_id))?.document ?? null) : null;
  }
  return row.payment_id ? ((await receiptDocument(db, row.payment_id))?.document ?? null) : null;
}

const CONTACT_SQL =
  'select id, client_id, phone, email, whatsapp_opt_in from contact ' +
  'where tenant_id = app.current_tenant_id() and id = $1 and client_id = $2';

/**
 * `POST /api/billing/documents/:id/send` — put a document in front of a family.
 *
 * **A hand-off, not a broadcast.** WhatsApp answers with a `wa.me` link the
 * person opens and presses send in; email answers through the sending seam,
 * whose only implementation today hands the link back for the share sheet
 * (`domain/billing/sending.ts`). Either way the practice is the one who sends,
 * which is how it works now and is what keeps an unapproved vendor out of a
 * family's contact details.
 *
 * **Recorded as the sensitive act it is**, with the contact's id and the
 * channel, and never the telephone number or the address (`./audit.ts`).
 *
 * **The contact must belong to this document's own client.** Checked against
 * the row rather than trusted from the body: a contact id from another
 * household would otherwise send one family's invoice to another.
 */
export function mountDocumentSending(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
  sender: DocumentSender = documentSender(),
): void {
  api.post('/api/billing/documents/:id/send', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayReadInvoices(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const documentId = c.req.param('id');
    if (!isUuid(documentId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const storage = c.get('storage');
    if (!storage) {
      return c.json({ error: 'storage_unavailable', requestId }, 503);
    }
    const body = SendDocumentInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }

    const db = c.get('db');
    const found = await db.query<FiledRow>(KIND_SQL, [documentId]);
    const row = found.rows[0];
    if (!row) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const contacts = await db.query<{
      id: string;
      phone: string | null;
      email: string | null;
      whatsapp_opt_in: boolean;
    }>(CONTACT_SQL, [body.data.contactId, row.client_id]);
    const contact = contacts.rows[0];
    if (!contact) {
      // Another household's contact, or none. Not found, never a refusal that
      // confirms whose it is.
      return c.json({ error: 'not_found', code: 'contact_not_found', requestId }, 404);
    }

    // Handing over the means to open a client's document is a read, and it is
    // recorded before the link is signed, every time (docs/SEAMS.md).
    await auditDocumentRead(db, { id: documentId, clientId: row.client_id });
    const url = await storage.getSignedUrl(row.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS);

    const practice = await db.query<{ supplier_legal_name: string }>(
      'select supplier_legal_name from invoice where tenant_id = app.current_tenant_id() ' +
        'and client_id = $1 order by number desc limit 1',
      [row.client_id],
    );
    const message = draftMessage({
      kind: row.kind,
      reference: row.reference ?? '',
      practiceName: practice.rows[0]?.supplier_legal_name ?? '',
      url,
    });

    let outcome: SendOutcome;
    if (body.data.channel === 'whatsapp') {
      if (!contact.whatsapp_opt_in) {
        // The household said no to WhatsApp. That answer is the whole point of
        // the column and it is not the sender's to overrule.
        return c.json({ error: 'unprocessable', code: 'no_whatsapp_opt_in', requestId }, 422);
      }
      const handoff = contact.phone ? whatsAppHandoff(contact.phone, message) : null;
      if (!handoff) {
        return c.json({ error: 'unprocessable', code: 'no_usable_number', requestId }, 422);
      }
      outcome = { delivered: false, channel: 'whatsapp', handoffUrl: handoff };
    } else {
      if (!contact.email) {
        return c.json({ error: 'unprocessable', code: 'no_email', requestId }, 422);
      }
      const sent = await sender.sendDocument({ to: contact.email, message });
      // The fallback sends nothing and hands the document's own link back, which
      // is what a person shares from their own mail app.
      outcome = sent.delivered ? sent : { delivered: false, channel: 'email', handoffUrl: url };
    }

    await logSensitiveAction(
      db,
      'send',
      { type: 'document', id: documentId, clientId: row.client_id },
      // The contact's id and the channel. Never the number, never the address.
      { channel: outcome.channel, contactId: contact.id, delivered: String(outcome.delivered) },
    );

    return c.json(
      SendDocumentResponse.parse({
        channel: outcome.channel,
        delivered: outcome.delivered,
        ...(outcome.delivered ? {} : { handoffUrl: outcome.handoffUrl }),
        message: message.text,
      }),
    );
  });
}
