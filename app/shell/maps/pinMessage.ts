/**
 * The message the pin picker (`app/admin/clients/pin/PinPickerPage.tsx`)
 * hands back to the tab that opened it, through `postMessage` with the
 * picker's own origin as the target — never a wildcard, so only a document of
 * this app can read it (docs/SPEC/route-planning.md section 8, trunk round
 * 43, "the pin on a map").
 *
 * **Its own module, not exported from the page, for two reasons — and the
 * second is the one that lasts.** The first is the bundle: `app/shell/
 * App.tsx` loads `PinPickerPage` lazily, so a console component importing the
 * page would drag the widened document's screen into the console's own chunk
 * and undo that split. (This half of the story has been true, then false,
 * then true again inside one round: the whole-branch review of trunk round 43,
 * finding 8, correctly struck it out when the page was imported statically,
 * and pull request 152's code-splitting restored it hours later. That is
 * precisely why it is not the reason to rely on.) The second does not move:
 * ownership. `app/shell/components/CoordinateFields.tsx` is a plain console
 * component with callers across the admin app, and it must not name the
 * widened, security-sensitive page it opens as an import target — the two are
 * deliberately separate documents with separate content security policies
 * (`app/api/_middleware/security.ts`, `MAP_DOCUMENT_PATHS`), and that stays
 * true however the bundler is configured next.
 *
 * `pinMessage.ts` carries nothing but the shape, so both sides import it and
 * neither names the other.
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
