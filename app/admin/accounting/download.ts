import type { ApiFetch } from '../../shell/auth/AuthContext';

/**
 * A statement as a file, fetched the way every other request is fetched.
 *
 * The API admits nothing without `Authorization: Bearer`
 * (app/api/_middleware/request-context.ts) and the token lives only inside
 * `apiFetch` (app/shell/auth/AuthContext.tsx); there is no cookie session
 * anywhere. So a plain `<a href="/api/accounting/...csv">` is a link to a 401:
 * the browser navigating it sends no header at all. The file is fetched with
 * the token, held as an object URL for one press and revoked straight after —
 * a statement is the practice's own figures and has no business outliving the
 * click (docs/SPEC/accounting.md sections 4.5, 4.6 and 5.4).
 */

/** What a download that did not happen says, whatever the server said. */
export const DOWNLOAD_REFUSED = 'The file could not be prepared. Try again.';

/**
 * The name the server put on the file, or the address's own last segment when
 * it sent none: a file saved as "trial-balance.csv" is a file a person can
 * find again, and "download" is not.
 */
export function filenameFrom(disposition: string | null, path: string): string {
  const header = disposition ?? '';
  const quoted = /filename="([^"]*)"/.exec(header)?.[1];
  const bare = /filename=([^;]+)/.exec(header)?.[1]?.trim();
  const named = (quoted ?? bare ?? '').trim();
  if (named !== '') {
    return named;
  }
  const address = path.split('?')[0] ?? '';
  const last = address
    .split('/')
    .filter((part) => part !== '')
    .at(-1);
  return last ?? 'export.csv';
}

/**
 * Fetches the file and hands it to the browser. Answers whether it arrived;
 * the screen turns a `false` into one fixed sentence and never the server's
 * own text.
 */
export async function downloadCsv(apiFetch: ApiFetch, path: string): Promise<boolean> {
  let objectUrl: string | null = null;
  try {
    const res = await apiFetch(path);
    if (!res.ok) {
      return false;
    }
    objectUrl = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filenameFrom(res.headers.get('content-disposition'), path);
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  } finally {
    // On the next task, not this one: a browser begins the download from the
    // click and an address revoked in the same turn can be gone before it does.
    const url = objectUrl;
    if (url !== null) {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
}
