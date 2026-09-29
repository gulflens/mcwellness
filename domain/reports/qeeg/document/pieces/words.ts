/**
 * Words handed to a piece of the report, and whether a person typed them.
 *
 * **Why a piece is told.** Fixed wording reads the way its report does; what
 * a person typed reads the way its first letter does (`typeset.ts`). A piece
 * cannot tell the two apart by looking, so a field that may have been typed
 * carries the answer with it, and the piece passes it on to `typeset`.
 */

export type Words = { readonly text: string; readonly typed: boolean };
export const fixed = (text: string): Words => ({ text, typed: false });
export const typed = (text: string): Words => ({ text, typed: true });
