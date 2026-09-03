import { useState } from 'react';
import { DocumentLinkResponse } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button } from '../../shell/components/Controls';

/**
 * Opening one filed document.
 *
 * The link is asked for at the moment somebody presses it, never rendered into
 * the page in advance, and that is the whole design. A signed link is a read:
 * the route writes the audit row before it signs, because signing is the only
 * moment there is an actor to name (app/api/_middleware/storage/audit.ts). A
 * page that pre-fetched links for every row would log the practice as having
 * opened every document on a client's record every time anyone glanced at the
 * tab, which is both untrue and the fastest way to make a trail worthless.
 *
 * It is good for five minutes. It is not stored, not reused, and not put in
 * the address bar — the browser opens it in a new tab and this component keeps
 * nothing.
 *
 * **Unless the browser refuses.** A popup blocker returns null from
 * `window.open` and says nothing, and pressing a button that does nothing at
 * all is the worst answer on this screen: the person concludes the file is
 * missing. So a refused open falls back to a plain anchor carrying the link,
 * which the person clicks themselves — a click the browser will honour,
 * because it is theirs. That link is held in state until the tab is closed or
 * the drawer goes, which is the one exception to keeping nothing, and it is
 * the same five minutes it was already good for.
 */
export function DocumentLink({
  clientId,
  documentId,
  label,
}: {
  clientId: string;
  documentId: string;
  label: string;
}) {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  async function open(): Promise<void> {
    setBusy(true);
    setError(null);
    setBlockedUrl(null);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/documents/${documentId}/link`);
      if (!res.ok) {
        setError(
          res.status === 503 ? 'The document store cannot be reached.' : 'That file did not open.',
        );
        return;
      }
      const { url } = DocumentLinkResponse.parse(await res.json());
      // noreferrer as well as noopener: the link carries a signature, and the
      // page it opens has no business knowing which screen sent it.
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      // A blocked popup is null and silent. Hand the link over rather than
      // leave a button that appears to do nothing.
      if (!opened) setBlockedUrl(url);
    } catch {
      setError('That file did not open.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="document-link">
      <Button
        variant="quiet"
        onClick={() => void open()}
        disabled={busy}
        aria-label={`${label}, opens in a new tab`}
      >
        {busy ? 'Opening…' : label}
      </Button>
      {blockedUrl ? (
        <span className="small" role="status">
          Your browser stopped the file opening.{' '}
          <a href={blockedUrl} target="_blank" rel="noopener noreferrer">
            Open it in a new tab
          </a>
        </span>
      ) : null}
      {error ? (
        <span className="field__hint field__hint--error small" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
