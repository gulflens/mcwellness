/**
 * Words handed to a piece of the report, and whether a person typed them.
 *
 * **Why a piece is told.** Fixed wording reads the way its report does. What
 * a person typed reads the way its first letter does, so an English name in
 * an Arabic report is still read left to right (`typeset.ts`). A piece
 * cannot tell the two apart by looking at the text, and must not guess, so
 * every field that may hold typed words carries the answer beside them.
 *
 * `fixed` and `typed` only say it shortly at the call site.
 */

export type Words = { readonly text: string; readonly typed: boolean };

/** Wording the report itself supplies: it reads the way its report does. */
export const fixed = (text: string): Words => ({ text, typed: false });

/** Words a person typed: they read the way their first letter does. */
export const typed = (text: string): Words => ({ text, typed: true });
