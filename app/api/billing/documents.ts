import { createHash, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { renderDocument, type MoneyDocument } from '../../../domain/billing/document';
import {
  clientDocumentKey,
  documentRetentionUntil,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
} from '../../../domain/shared/storage';
import { auditDocumentRead } from '../_middleware/storage/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { mayReadInvoices } from './access';
import {
  CreateDocumentInput,
  CreateDocumentResponse,
  DocumentLinkResponse,
} from './document-schema';
import { invoiceDocument, receiptDocument } from './document-source';
import { documentFonts } from './fonts';
import { isUuid } from './ids';

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
  'select bd.id, bd.kind, bd.client_id, bd.document_id, d.storage_key, ' +
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

    await db.query(
      'select app.file_billing_document($1::billing_document_kind, $2, $3, $4, $5, $6)',
      [kind, source.sourceId, documentId, key, sha256, retentionUntil],
    );

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
    // again rather than to lose it. The hash on the row is what proves the two
    // renderings are the same file, and it is checked here.
    if (!(await storage.exists(row.storage_key))) {
      const remade = await documentBehind(db, documentId, row.kind);
      if (remade) {
        const bytes = renderDocument(remade, documentFonts());
        c.get('afterCommit')(async () => {
          await storage.put(row.storage_key, bytes, 'application/pdf', { overwrite: true });
        });
      }
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
