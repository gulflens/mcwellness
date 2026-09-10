/**
 * The message the pin picker (`app/admin/clients/pin/PinPickerPage.tsx`)
 * hands back to the tab that opened it, through `postMessage` with the
 * picker's own origin as the target — never a wildcard, so only a document of
 * this app can read it (docs/SPEC/route-planning.md section 8, trunk round
 * 43, "the pin on a map").
 *
 * **Its own module, not exported from the page — but not for the reason a
 * comment here once gave.** It is not to keep the page, and the Places
 * library it loads, out of the console's bundle: `app/shell/App.tsx` already
 * imports `PinPickerPage` statically for its route, so the page is in that
 * bundle regardless, and Places is never bundled at all — it arrives as a
 * runtime `<script>` tag, the same for every document that loads it (the
 * whole-branch review of trunk round 43, finding 8: that story was never
 * true). The real reason is ownership: `app/shell/components/
 * CoordinateFields.tsx` is a plain console component with callers across the
 * admin app, and it must not name the widened, security-sensitive page it
 * opens as an import target — the two are deliberately separate documents
 * with separate content security policies (`app/api/_middleware/
 * security.ts`, `MAP_DOCUMENT_PATHS`), and a direct import would survive a
 * future code-split that lazy-loads the page for exactly that separation,
 * quietly re-coupling them. `pinMessage.ts` carries nothing but the shape,
 * so both sides import it and neither names the other.
 */

export const PIN_MESSAGE_TYPE = 'mcwellness:pin';

export type PinMessage = {
  type: typeof PIN_MESSAGE_TYPE;
  lat: number;
  lng: number;
  /** The address the search found, or null when the pin was placed by hand. */
  address: string | null;
  /**
   * The same opaque key `CoordinateFields.openPicker` minted and put on the
   * picker's URL (`?k=`), echoed back so the listener can tell its own
   * still-open tab's answer from any other tab's. `LocationsTab.tsx` keeps
   * one location panel open at a time, but the picker tab a panel opened
   * outlives the panel closing — so without this, closing "Check the pin"
   * on one client and opening it on another, then returning to the first
   * client's still-open tab and pressing "Use this pin", moved the second
   * client's boxes to the first client's point (the whole-branch review of
   * trunk round 43, finding 1 — the harm this branch exists to prevent).
   * `CoordinateFields`'s listener rejects any message whose `key` is not the
   * one it minted for its own currently-open tab.
   */
  key: string;
};
