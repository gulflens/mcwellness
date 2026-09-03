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
 * **The window is opened before either request.** A browser only lets a page
 * open a tab in direct response to a click, so waiting for the fetch first gets
 * the tab blocked and the person sees nothing happen. It opens blank and is
 * pointed at the document once the link comes back — or closed again, so a
 * failure does not leave an empty tab behind.
 */

export type DocumentSource = { invoiceId: string } | { paymentId: string };

const MESSAGES: Record<string, string> = {
  storage_unavailable: 'The document store cannot be reached. Try again shortly.',
  forbidden: "You don't have permission to open this document.",
  not_found: 'That document is no longer available. Refresh and try again.',
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
      // Opened now, while this is still the click's own turn.
      const tab = window.open('', '_blank', 'noopener');
      try {
        const document_ = await ensure(source);
        if (!document_) {
          tab?.close();
          return;
        }
        const res = await apiFetch(`/api/billing/documents/${document_.id}/link`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(MESSAGES[body?.error ?? ''] ?? GENERIC);
          tab?.close();
          return;
        }
        const link = (await res.json()) as DocumentLinkResponse;
        if (tab) {
          tab.location.href = link.url;
        }
      } catch {
        setError(GENERIC);
        tab?.close();
      } finally {
        setBusyOn(null);
      }
    },
    [apiFetch, ensure],
  );

  return { open, ensure, busyOn, error, setError };
}
