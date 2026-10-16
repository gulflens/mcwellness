/**
 * Opens a page in a new tab, and answers whether the browser let it.
 *
 * **Why not `window.open(url, '_blank', 'noopener,noreferrer')`.** With
 * "noopener" in the features, the HTML standard has `window.open` return null
 * whether or not the tab opened. A screen that read null as "blocked" — the
 * preview of a report, a client's document, an assessment's export, the
 * erasure letter's WhatsApp draft — said the browser had stopped it every
 * time it had not (docs/CHANGE-REQUESTS/docfix-02.md). So the tab is opened
 * without the feature, and null then means what it says.
 *
 * **What "noopener" was for is still done.** The opened page's `opener` is
 * cut here, before it has loaded, so it can never reach back into the
 * console. What "noreferrer" was for is the console's own header: the app is
 * served with `Referrer-Policy: no-referrer` (`app/api/_middleware/security.ts`),
 * except on the map pages, which send their origin alone because the maps key
 * needs one — and no address in this app names a person (.claude/rules/ui.md).
 * So a signed link opened from the console is never told which screen sent it.
 */
export function openInNewTab(url: string): boolean {
  const opened = window.open(url, '_blank');
  if (opened === null) return false;
  opened.opener = null;
  return true;
}
