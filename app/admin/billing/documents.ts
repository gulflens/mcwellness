import { useCallback, useState } from 'react';
import type {
  CreateDocumentResponse,
  DocumentLinkResponse,
} from '../../api/billing/document-schema';
import { useAuth } from '../../shell/auth/AuthContext';

/**
 * Opening a rendered invoice or receipt from a row.
 *
 * Two requests, because they are two acts: one makes the document if it has not
 * been made, and one asks for a short-lived link to it. The second is recorded
 * in the trail as a read of a client's file, which is why the screen does not
 * hold on to a link and reuse it.
 *
 * **The tab is opened on the document itself**, once both answers are back.
 * The first version opened a blank tab during the click and pointed it at the
 * link afterwards, to stay inside the user gesture — but it asked for
 * `noopener`, and `noopener` is precisely what makes `window.open` hand back
 * nothing to point. So the tab opened blank and stayed blank, on every row,
 * and the test did not catch it because it stubbed `window.open` with an object
 * that had a settable `location`.
 *
 * Opening the real URL needs no handle, keeps `noopener`, and is the only shape
 * of this that can be tested for what it actually does: that the signed link is
 * what the browser was asked to open.
 */

export type DocumentSource = { invoiceId: string } | { paymentId: string };

const MESSAGES: Record<string, string> = {
  storage_unavailable: 'The document store cannot be reached. Try again shortly.',
  forbidden: "You don't have permission to open this document.",
  not_found: 'That document is no longer available. Refresh and try again.',
  // The document on file and the document this would render are not the same
  // one, so nothing is put back over it (app/api/billing/documents.ts).
  document_bytes_differ:
    'This document no longer matches what was filed. Ask for it to be looked at.',
};
const GENERIC = 'The document could not be opened. Try again.';

export function useDocumentActions() {
  const { apiFetch } = useAuth();
  const [busyOn, setBusyOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Makes the document if it does not exist, and answers its id. */
  const ensure = useCallback(
    async (source: DocumentSource): Promise<CreateDocumentResponse['document'] | null> => {
      const res = await apiFetch('/api/billing/documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(source),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(MESSAGES[body?.error ?? ''] ?? GENERIC);
        return null;
      }
      return ((await res.json()) as CreateDocumentResponse).document;
    },
    [apiFetch],
  );

  const open = useCallback(
    async (rowKey: string, source: DocumentSource) => {
      setError(null);
      setBusyOn(rowKey);
      try {
        const document_ = await ensure(source);
        if (!document_) return;
        const res = await apiFetch(`/api/billing/documents/${document_.id}/link`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          setError(MESSAGES[body?.code ?? ''] ?? MESSAGES[body?.error ?? ''] ?? GENERIC);
          return;
        }
        const link = (await res.json()) as DocumentLinkResponse;
        window.open(link.url, '_blank', 'noopener');
      } catch {
        setError(GENERIC);
      } finally {
        setBusyOn(null);
      }
    },
    [apiFetch, ensure],
  );

  return { open, ensure, busyOn, error, setError };
}
