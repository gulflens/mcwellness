/**
 * The message the pin picker (`app/admin/clients/pin/PinPickerPage.tsx`)
 * hands back to the tab that opened it, through `postMessage` with the
 * picker's own origin as the target — never a wildcard, so only a document of
 * this app can read it (docs/SPEC/route-planning.md section 8, trunk round
 * 43, "the pin on a map").
 *
 * **Its own module, not exported from the page.** `app/shell/components/
 * CoordinateFields.tsx`, the console component that opens the picker and
 * listens for this message, is part of the console's own bundle. If it
 * imported the shape from `PinPickerPage.tsx`, the page — and the Places
 * library it loads — would be pulled into that bundle too, the very thing
 * the picker's own document exists to avoid (`app/api/_middleware/
 * security.ts`, `MAP_DOCUMENT_PATHS`). `pinMessage.ts` carries nothing but
 * the shape, so both sides import it and neither carries the other in.
 */

export const PIN_MESSAGE_TYPE = 'mcwellness:pin';

export type PinMessage = {
  type: typeof PIN_MESSAGE_TYPE;
  lat: number;
  lng: number;
  /** The address the search found, or null when the pin was placed by hand. */
  address: string | null;
};
