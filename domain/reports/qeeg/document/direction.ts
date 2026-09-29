/**
 * The way a line, a paragraph or a frame reads: left to right, or right to
 * left.
 *
 * **Why a module of its own.** `bidi.ts` decides which words run which way,
 * `frame.ts` turns start and end into physical x, and `paragraph.ts` lays
 * lines out; all three speak of direction, and none should depend on another
 * just to borrow the word. So the type lives here, once, and each imports it.
 */

export type Direction = 'ltr' | 'rtl';
